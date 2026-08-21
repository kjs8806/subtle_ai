import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'
import { createSessionManager } from '../server/security/session.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Real Google `sub` claims are opaque numeric strings, not UUIDs.
const GOOGLE_SUBJECT_A = '104857612345678901234'
const GOOGLE_SUBJECT_B = '211348800987654321000'

// exchangeAuthorizationCode/exchangeGmailAuthorizationCode read the subject out of
// the mock code itself, so tests can drive sign-in and Gmail-connect as distinct
// Google identities against one running app.
const createTestProvider = (extra = {}) => ({
  ...createFakeGmailProvider(),
  exchangeAuthorizationCode: async ({ code }) => {
    const subject = code.replace('mock-success:', '')
    return { status: 'authorized', subject, email: `${subject}@example.com`, refreshToken: 'mock-refresh-token' }
  },
  exchangeGmailAuthorizationCode: async ({ code }) => {
    const subject = code.replace('mock-gmail:', '')
    return { status: 'authorized', subject, refreshToken: 'mock-gmail-refresh-token' }
  },
  ...extra,
})

const authenticate = async (app, subject) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?state=${state}&code=mock-success:${subject}`,
    cookies: { subtle_oauth_state: state },
  })
  assert.equal(callback.statusCode, 200)
  const token = callback.cookies.find(({ name }) => name === 'subtle_session').value
  const headers = { cookie: `subtle_session=${token}` }
  const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  return { token, headers, user: me.json().user }
}

const connectGmail = async (app, headers, subject) => {
  const start = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers })
  const state = start.cookies.find(({ name }) => name === 'subtle_gmail_oauth_state').value
  return app.inject({
    method: 'GET',
    url: `/api/v1/sources/gmail/callback?state=${state}&code=mock-gmail:${subject}`,
    headers: { ...headers, cookie: `${headers.cookie}; subtle_gmail_oauth_state=${state}` },
  })
}

test('a realistic non-UUID Google subject can sign in and is mapped to an internally generated UUID user', async () => {
  const app = buildApp({ provider: createTestProvider(), gmailProvider: 'google' })
  const { user } = await authenticate(app, GOOGLE_SUBJECT_A)
  assert.ok(user)
  assert.match(user.id, UUID_RE)
  assert.notEqual(user.id, GOOGLE_SUBJECT_A)
})

test('the Google subject is stored on the auth identity, not as users.id', async () => {
  const repository = createMemoryRepository()
  const app = buildApp({ repository, provider: createTestProvider(), gmailProvider: 'google' })
  const { user } = await authenticate(app, GOOGLE_SUBJECT_A)
  const identity = await repository.getIdentityForUser({ userId: user.id, provider: 'google' })
  assert.equal(identity.subject, GOOGLE_SUBJECT_A)
})

test('repeated sign-in with the same Google subject returns the same internal user', async () => {
  const repository = createMemoryRepository()
  const app = buildApp({ repository, provider: createTestProvider(), gmailProvider: 'google' })
  const first = await authenticate(app, GOOGLE_SUBJECT_A)
  const second = await authenticate(app, GOOGLE_SUBJECT_A)
  assert.equal(first.user.id, second.user.id)
})

test('different Google subjects create different internal users', async () => {
  const repository = createMemoryRepository()
  const app = buildApp({ repository, provider: createTestProvider(), gmailProvider: 'google' })
  const a = await authenticate(app, GOOGLE_SUBJECT_A)
  const b = await authenticate(app, GOOGLE_SUBJECT_B)
  assert.notEqual(a.user.id, b.user.id)
})

test('the session userId is the internal UUID, not the Google subject', async () => {
  const sessions = createSessionManager()
  const app = buildApp({ sessions, provider: createTestProvider(), gmailProvider: 'google' })
  const { token, user } = await authenticate(app, GOOGLE_SUBJECT_A)
  const resolved = sessions.resolve(token)
  assert.equal(resolved.userId, user.id)
  assert.match(resolved.userId, UUID_RE)
})

test('Gmail OAuth with a matching Google subject connects the source', async () => {
  const app = buildApp({ provider: createTestProvider(), gmailProvider: 'google' })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  const response = await connectGmail(app, headers, GOOGLE_SUBJECT_A)
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().status, 'connected')
})

test('Gmail OAuth with a different Google subject is rejected as identity_mismatch', async () => {
  const app = buildApp({ provider: createTestProvider(), gmailProvider: 'google' })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  const response = await connectGmail(app, headers, GOOGLE_SUBJECT_B)
  assert.equal(response.statusCode, 409)
  assert.equal(response.json().error.code, 'identity_mismatch')
})

test('identity mismatch does not store a refresh token or connect Gmail', async () => {
  const repository = createMemoryRepository()
  const app = buildApp({ repository, provider: createTestProvider(), gmailProvider: 'google' })
  const { headers, user } = await authenticate(app, GOOGLE_SUBJECT_A)
  await connectGmail(app, headers, GOOGLE_SUBJECT_B)
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'not_connected')
  assert.equal(await repository.getEncryptedRefreshToken(user.id), null)
})

test('account isolation holds when ownership is keyed by internal UUID', async () => {
  const app = buildApp({ provider: createTestProvider(), gmailProvider: 'google' })
  const userA = await authenticate(app, GOOGLE_SUBJECT_A)
  const userB = await authenticate(app, GOOGLE_SUBJECT_B)
  await connectGmail(app, userA.headers, GOOGLE_SUBJECT_A)

  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: userA.headers })
  assert.equal(scan.statusCode, 200)

  const subsA = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userA.headers })
  assert.equal(subsA.json().subscriptions.length, 1)
  const subsB = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userB.headers })
  assert.equal(subsB.json().subscriptions.length, 0)

  const subscriptionId = subsA.json().subscriptions[0].id
  const forbidden = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers: userB.headers })
  assert.equal(forbidden.statusCode, 404)
})
