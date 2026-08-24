import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'

// MVP-BETA-004 (#41): DELETE /api/v1/account. Every test here uses a
// distinct Google subject per user (mirrors identity.test.js's pattern) so
// ownership can be verified across two real, separately-authenticated
// accounts rather than the single shared 'mock-user' the rest of the suite
// uses under GMAIL_PROVIDER=mock.
const createTestProvider = (extra = {}) => ({
  ...createFakeGmailProvider(),
  exchangeAuthorizationCode: async ({ code }) => {
    const subject = code.replace('mock-success:', '')
    return { status: 'authorized', subject, email: `${subject}@example.com`, refreshToken: 'mock-refresh-token' }
  },
  ...extra,
})

const SUBJECT_A = '104857612345678901234'
const SUBJECT_B = '211348800987654321000'

const authenticate = async (app, subject) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=mock-success:${subject}`, cookies: { subtle_oauth_state: state } })
  assert.equal(callback.statusCode, 302)
  const token = callback.cookies.find(({ name }) => name === 'subtle_session').value
  const headers = { cookie: `subtle_session=${token}` }
  const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  return { token, headers, user: me.json().user }
}

// Gives an authenticated user a real subscription via the mock Gmail
// provider's connect+scan path, so deletion has actual data to purge -
// asserting against an account that was always empty would prove nothing.
const giveUserAScannedSubscription = async (app, headers) => {
  const authorize = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers })
  assert.equal(authorize.json().status, 'connected')
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 200)
  assert.ok(scan.json().found > 0, 'expected the mock provider to produce at least one subscription')
}

test('DELETE /api/v1/account requires authentication', async () => {
  const app = buildApp({ repository: createMemoryRepository(), provider: createTestProvider() })
  const response = await app.inject({ method: 'DELETE', url: '/api/v1/account' })
  assert.equal(response.statusCode, 401)
})

test('deleting the account signs the user out and their data becomes inaccessible', async () => {
  const app = buildApp({ repository: createMemoryRepository(), provider: createTestProvider() })
  const { headers } = await authenticate(app, SUBJECT_A)
  await giveUserAScannedSubscription(app, headers)

  const del = await app.inject({ method: 'DELETE', url: '/api/v1/account', headers })
  assert.equal(del.statusCode, 200)
  assert.equal(del.json().status, 'deleted')
  assert.ok(del.cookies.find(({ name }) => name === 'subtle_session'), 'expected the session cookie to be cleared in the response')

  const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  assert.equal(session.json().authenticated, false)

  // The same cookie must no longer authenticate anything, not just /session.
  const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subscriptions.statusCode, 401)
})

test('deleting one account never affects another user\'s session or data', async () => {
  const repository = createMemoryRepository()
  const app = buildApp({ repository, provider: createTestProvider() })
  const userA = await authenticate(app, SUBJECT_A)
  const userB = await authenticate(app, SUBJECT_B)
  await giveUserAScannedSubscription(app, userA.headers)
  await giveUserAScannedSubscription(app, userB.headers)

  const beforeCount = (await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userB.headers })).json().subscriptions.length
  assert.ok(beforeCount > 0)

  const del = await app.inject({ method: 'DELETE', url: '/api/v1/account', headers: userA.headers })
  assert.equal(del.statusCode, 200)

  // User A is gone.
  const sessionA = await app.inject({ method: 'GET', url: '/api/v1/session', headers: userA.headers })
  assert.equal(sessionA.json().authenticated, false)

  // User B's session and data are completely untouched.
  const sessionB = await app.inject({ method: 'GET', url: '/api/v1/session', headers: userB.headers })
  assert.equal(sessionB.json().authenticated, true)
  assert.equal(sessionB.json().user.id, userB.user.id)
  const afterCount = (await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userB.headers })).json().subscriptions.length
  assert.equal(afterCount, beforeCount)
})

test('a user cannot delete another user\'s account by any means available through the API', async () => {
  // There is no id in the DELETE /api/v1/account contract at all (see
  // server/app.js: it always deletes request.user.id) - this proves that,
  // rather than merely asserting no such parameter exists, by trying the
  // request forms that WOULD let an id leak through if the route ever
  // regressed to reading one from the client.
  const repository = createMemoryRepository()
  const app = buildApp({ repository, provider: createTestProvider() })
  const userA = await authenticate(app, SUBJECT_A)
  const userB = await authenticate(app, SUBJECT_B)

  const attempts = [
    { method: 'DELETE', url: '/api/v1/account', headers: userA.headers, body: JSON.stringify({ userId: userB.user.id }) },
    { method: 'DELETE', url: `/api/v1/account?userId=${userB.user.id}`, headers: userA.headers },
    { method: 'DELETE', url: `/api/v1/account/${userB.user.id}`, headers: userA.headers },
  ]
  for (const attempt of attempts) {
    await app.inject(attempt).catch(() => {}) // a 404 for the third form is an acceptable rejection, not a security hole
  }

  const sessionB = await app.inject({ method: 'GET', url: '/api/v1/session', headers: userB.headers })
  assert.equal(sessionB.json().authenticated, true, 'user B must still exist and be signed in after every attempt above')
})

test('every session belonging to the deleted user is revoked, not only the one that requested deletion', async () => {
  const app = buildApp({ repository: createMemoryRepository(), provider: createTestProvider() })
  // Two concurrent logins for the same identity (e.g. two devices/tabs) - the
  // fake provider returns a stable subject for the same mock code, so
  // authenticating twice resolves to the same internal user with two
  // independent session tokens.
  const deviceOne = await authenticate(app, SUBJECT_A)
  const deviceTwo = await authenticate(app, SUBJECT_A)
  assert.notEqual(deviceOne.token, deviceTwo.token)
  assert.equal(deviceOne.user.id, deviceTwo.user.id)

  const del = await app.inject({ method: 'DELETE', url: '/api/v1/account', headers: deviceOne.headers })
  assert.equal(del.statusCode, 200)

  const sessionOne = await app.inject({ method: 'GET', url: '/api/v1/session', headers: deviceOne.headers })
  const sessionTwo = await app.inject({ method: 'GET', url: '/api/v1/session', headers: deviceTwo.headers })
  assert.equal(sessionOne.json().authenticated, false)
  assert.equal(sessionTwo.json().authenticated, false, 'a second concurrent session for the deleted user must also be revoked')
})

test('re-authenticating with the same Google identity after deletion creates a brand-new account, never resurrecting old data', async () => {
  const app = buildApp({ repository: createMemoryRepository(), provider: createTestProvider() })
  const first = await authenticate(app, SUBJECT_A)
  await giveUserAScannedSubscription(app, first.headers)
  await app.inject({ method: 'DELETE', url: '/api/v1/account', headers: first.headers })

  const second = await authenticate(app, SUBJECT_A)
  assert.notEqual(second.user.id, first.user.id, 'expected a new internal user id, not the deleted one')
  const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: second.headers })
  assert.deepEqual(subscriptions.json().subscriptions, [], 'the new account must start with zero subscriptions, not the deleted account\'s data')
  // GMAIL_PROVIDER=mock connects Gmail as a side effect of sign-in itself
  // (server/app.js's OIDC callback, a pre-existing demo/prototype
  // convenience - not something this account-deletion work changes), so the
  // new account is expected to show 'connected' here - the point of this
  // assertion is that it is a *fresh* connection with no scan history, not
  // that it starts disconnected.
  const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers: second.headers })
  assert.equal(source.json().status, 'connected')
  assert.equal(source.json().lastScanAt, null, 'the new account must have no scan history from the deleted account')
})

test('a failed Gmail revocation never blocks account deletion', async () => {
  const app = buildApp({
    repository: createMemoryRepository(),
    provider: createTestProvider({ revokeConnection: async () => { throw new Error('Google is unreachable') } }),
  })
  const { headers } = await authenticate(app, SUBJECT_A)
  await giveUserAScannedSubscription(app, headers)
  const del = await app.inject({ method: 'DELETE', url: '/api/v1/account', headers })
  assert.equal(del.statusCode, 200)
  assert.equal(del.json().status, 'deleted')
  const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  assert.equal(session.json().authenticated, false)
})

test('deleting an account with no Gmail connection at all still succeeds', async () => {
  const app = buildApp({ repository: createMemoryRepository(), provider: createTestProvider() })
  const { headers } = await authenticate(app, SUBJECT_A)
  const del = await app.inject({ method: 'DELETE', url: '/api/v1/account', headers })
  assert.equal(del.statusCode, 200)
})

test('DELETE /api/v1/account does not require an Origin header outside GMAIL_PROVIDER=google/production', async () => {
  // Same-origin enforcement is gated on `secure` (production || gmailProvider
  // === 'google'), matching every other mutating route's convention - this
  // just confirms the new route was wired through the same hook rather than
  // accidentally bypassing or duplicating it.
  const app = buildApp({ repository: createMemoryRepository(), provider: createTestProvider() })
  const { headers } = await authenticate(app, SUBJECT_A)
  const del = await app.inject({ method: 'DELETE', url: '/api/v1/account', headers })
  assert.equal(del.statusCode, 200)
})

test('DELETE /api/v1/account is rejected without a matching Origin when same-origin enforcement is active', async () => {
  const app = buildApp({ repository: createMemoryRepository(), provider: createTestProvider(), gmailProvider: 'google', publicOrigin: 'http://127.0.0.1:5173' })
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=mock-success:${SUBJECT_A}`, cookies: { subtle_oauth_state: state } })
  const token = callback.cookies.find(({ name }) => name === 'subtle_session').value
  const headers = { cookie: `subtle_session=${token}` }
  const del = await app.inject({ method: 'DELETE', url: '/api/v1/account', headers })
  assert.equal(del.statusCode, 403)
  const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  assert.equal(session.json().authenticated, true, 'a rejected same-origin check must not have deleted the account')
})
