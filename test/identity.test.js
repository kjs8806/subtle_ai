import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'
import { createSessionManager } from '../server/security/session.js'
import { createTokenVault } from '../server/security/tokenVault.js'

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

// Real Google mode always enforces same-origin on mutations (server/app.js ties
// this to GMAIL_PROVIDER=google, not NODE_ENV), so these POSTs need a matching
// Origin header even though `production` is left at its default of false here.
const sameOrigin = { origin: 'http://127.0.0.1:5173' }

const connectGmail = async (app, headers, subject) => {
  const start = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: { ...headers, ...sameOrigin } })
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

  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: { ...userA.headers, ...sameOrigin } })
  assert.equal(scan.statusCode, 200)

  const subsA = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userA.headers })
  assert.equal(subsA.json().subscriptions.length, 1)
  const subsB = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userB.headers })
  assert.equal(subsB.json().subscriptions.length, 0)

  const subscriptionId = subsA.json().subscriptions[0].id
  const forbidden = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers: userB.headers })
  assert.equal(forbidden.statusCode, 404)
})

// Wraps a repository so tests can assert identity/token-persistence calls never
// happened for a rejected auth attempt, not just that the HTTP response looked right.
const withCallCounts = (repository) => {
  const counts = { resolveOrCreateIdentity: 0, authorizeConnection: 0 }
  return {
    repository: {
      ...repository,
      resolveOrCreateIdentity: async (...args) => { counts.resolveOrCreateIdentity += 1; return repository.resolveOrCreateIdentity(...args) },
      authorizeConnection: async (...args) => { counts.authorizeConnection += 1; return repository.authorizeConnection(...args) },
    },
    counts,
  }
}

test('SEC-001: real Google auth fails closed on missing, null, empty, and malformed subject', async () => {
  for (const subject of [undefined, null, '', '   ', 12345]) {
    const { repository, counts } = withCallCounts(createMemoryRepository())
    const provider = createTestProvider({ exchangeAuthorizationCode: async () => ({ status: 'authorized', subject, email: 'attacker@example.com', refreshToken: 'mock-refresh-token' }) })
    const app = buildApp({ repository, provider, gmailProvider: 'google' })

    const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
    const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
    const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=irrelevant`, cookies: { subtle_oauth_state: state } })

    assert.equal(callback.statusCode, 401, `subject ${JSON.stringify(subject)} must be rejected`)
    assert.equal(callback.json().error.code, 'missing_subject')
    assert.equal(callback.cookies.find(({ name }) => name === 'subtle_session'), undefined, 'no session cookie may be issued')
    assert.equal(counts.resolveOrCreateIdentity, 0, 'no identity may be created or upserted')

    const session = await app.inject({ method: 'GET', url: '/api/v1/session' })
    assert.equal(session.json().authenticated, false)
  }
})

test('SEC-001: the mock-provider deterministic identity never activates for GMAIL_PROVIDER=google', async () => {
  // Even if a misbehaving provider fails to return a subject, google mode must
  // never fall back to the mock-provider's deterministic 'mock-user' identity or
  // issue a session for it.
  const sessions = createSessionManager()
  const provider = createTestProvider({ exchangeAuthorizationCode: async () => ({ status: 'authorized', refreshToken: 'mock-refresh-token' }) })
  const app = buildApp({ provider, gmailProvider: 'google', sessions })
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=irrelevant`, cookies: { subtle_oauth_state: state } })
  assert.equal(callback.statusCode, 401)
  assert.equal(callback.cookies.find(({ name }) => name === 'subtle_session'), undefined)
})

test('SEC-002: Gmail OAuth with a missing, null, or empty subject cannot connect and persists no refresh token', async () => {
  for (const subject of [undefined, null, '']) {
    const { repository, counts } = withCallCounts(createMemoryRepository())
    const provider = createTestProvider({ exchangeGmailAuthorizationCode: async () => ({ status: 'authorized', subject, refreshToken: 'never-store' }) })
    const app = buildApp({ repository, provider, gmailProvider: 'google' })
    const { headers, user } = await authenticate(app, GOOGLE_SUBJECT_A)

    const response = await connectGmail(app, headers, GOOGLE_SUBJECT_A)
    assert.equal(response.statusCode, 409, `subject ${JSON.stringify(subject)} must be rejected`)
    assert.equal(response.json().error.code, 'identity_mismatch')
    assert.equal(counts.authorizeConnection, 0, 'authorizeConnection() must not run for a rejected Gmail identity')

    const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
    assert.equal(connection.json().status, 'not_connected')
    assert.equal(await repository.getEncryptedRefreshToken(user.id), null)
  }
})

test('SEC-004: successful Gmail token revocation purges the local connection', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  let revokedToken = null
  const provider = createTestProvider({ revokeConnection: async ({ token }) => { revokedToken = token; return { status: 'disconnected' } } })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })
  const { headers, user } = await authenticate(app, GOOGLE_SUBJECT_A)
  await connectGmail(app, headers, GOOGLE_SUBJECT_A)
  assert.notEqual(await repository.getEncryptedRefreshToken(user.id), null)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.equal(response.statusCode, 200)
  assert.equal(revokedToken, 'mock-gmail-refresh-token')
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'not_connected')
})

test('SEC-004: a failed provider revocation does not report disconnected and preserves the token for retry', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const provider = createTestProvider({ revokeConnection: async () => ({ status: 'revocation_failed' }) })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })
  const { headers, user } = await authenticate(app, GOOGLE_SUBJECT_A)
  await connectGmail(app, headers, GOOGLE_SUBJECT_A)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.notEqual(response.statusCode, 200)
  assert.equal(response.json().error.code, 'revocation_failed')
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'connected')
  assert.notEqual(await repository.getEncryptedRefreshToken(user.id), null)
})

test('SEC-004: a network exception during revocation does not report disconnected and preserves the token for retry', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const provider = createTestProvider({ revokeConnection: async () => { throw new Error('network unreachable') } })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })
  const { headers, user } = await authenticate(app, GOOGLE_SUBJECT_A)
  await connectGmail(app, headers, GOOGLE_SUBJECT_A)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.notEqual(response.statusCode, 200)
  assert.equal(response.json().error.code, 'revocation_failed')
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'connected')
  assert.notEqual(await repository.getEncryptedRefreshToken(user.id), null)
})

test('SEC-004: a retried disconnect after a failed revocation can still succeed', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  let attempt = 0
  const provider = createTestProvider({
    revokeConnection: async () => { attempt += 1; return attempt === 1 ? { status: 'revocation_failed' } : { status: 'disconnected' } },
  })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await connectGmail(app, headers, GOOGLE_SUBJECT_A)

  const first = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.notEqual(first.statusCode, 200)
  const second = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.equal(second.statusCode, 200)
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'not_connected')
})
