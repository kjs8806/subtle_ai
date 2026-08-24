// Regression coverage requested by QA after PR #35 run #69: proves the
// per-test browser identity isolation mechanism (server/gmail/fakeProvider.js's
// mock-success:<uuid> code, minted fresh by createAuthorizationRequest on
// every /auth/google/start call) actually produces independent identities,
// sessions, and Gmail-source state end to end - using the REAL, unmodified
// mock provider (never a custom test-harness override), because that is
// exactly what the Playwright smoke suite's browser clicks drive.
//
// This exists to settle a real ambiguity: two different root causes can
// produce the identical visible symptom ("Find subscriptions from receipts"
// expected, "Scan receipts" received) - (a) the isolation mechanism failing
// to mint independent identities, or (b) sign-in correctly producing
// independent identities that are each, individually, still auto-connected
// at sign-in time regardless of who they are. Asserting only on UI text
// cannot distinguish these; asserting on the actual identity/session/source
// values at every step can, and does here.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Drives the exact same two-request round trip a real browser click makes:
// GET /auth/google/start (which calls the real provider's
// createAuthorizationRequest and returns the URL it generated) -> follow
// that URL's own state and code -> GET /auth/google/callback. Nothing here
// constructs its own code or subject; every value is read back from what the
// server itself produced, the same way the browser does.
const signIn = async (app) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const { url } = start.json()
  const code = new URL(url, 'http://localhost').searchParams.get('code')
  assert.match(code, /^mock-success:[0-9a-f-]{36}$/i, 'createAuthorizationRequest must mint a mock-success:<uuid> code, not a fixed literal')
  const subject = code.slice('mock-success:'.length)
  assert.match(subject, UUID_RE)

  const callback = await app.inject({ method: 'GET', url, cookies: { subtle_oauth_state: state } })
  assert.equal(callback.statusCode, 302)
  const sessionCookie = callback.cookies.find(({ name }) => name === 'subtle_session').value

  const headers = { cookie: `subtle_session=${sessionCookie}` }
  const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  assert.equal(session.json().authenticated, true)
  const userId = session.json().user.id
  assert.match(userId, UUID_RE)

  return { code, subject, sessionCookie, userId, headers }
}

test('two independent mock sign-ins through the real provider produce distinct codes, subjects, user UUIDs, and sessions', async () => {
  const app = buildApp({ provider: createFakeGmailProvider() })
  const a = await signIn(app)
  const b = await signIn(app)

  assert.notEqual(a.code, b.code, 'each /auth/google/start call must mint its own authorization code')
  assert.notEqual(a.subject, b.subject, 'each authorization code must carry its own provider subject')
  assert.notEqual(a.userId, b.userId, 'distinct subjects must resolve to distinct internal user UUIDs via resolveOrCreateIdentity')
  assert.notEqual(a.sessionCookie, b.sessionCookie, 'each sign-in must issue its own session token')
})

test('sign-in never auto-connects Gmail, and one identity connecting/scanning is never visible to another', async () => {
  const provider = createFakeGmailProvider()
  const app = buildApp({ provider })

  const a = await signIn(app)
  const b = await signIn(app)
  const c = await signIn(app)

  // Every fresh identity starts with Gmail disconnected - sign-in and Gmail
  // authorization are separate steps (see server/app.js's callback and
  // docs/product/features/FEATURE-001.md), for the mock provider exactly as
  // for the real one.
  for (const identity of [a, b, c]) {
    const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers: identity.headers })
    assert.equal(source.json().status, 'not_connected', `${identity.userId} must start disconnected, never pre-connected by sign-in alone`)
  }

  // A explicitly connects and scans (the default mock scenario always finds
  // at least one subscription - see server/gmail/fakeProvider.js).
  const connect = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: a.headers, payload: {} })
  assert.equal(connect.statusCode, 200)
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: a.headers })
  assert.equal(scan.statusCode, 200)
  assert.ok(scan.json().found > 0)

  const aSource = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers: a.headers })
  assert.equal(aSource.json().status, 'connected')
  const aSubscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: a.headers })
  assert.ok(aSubscriptions.json().subscriptions.length > 0)

  // B and C remain completely unaffected by A's connect+scan: still
  // disconnected, and unable to see any of A's subscription data.
  for (const identity of [b, c]) {
    const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers: identity.headers })
    assert.equal(source.json().status, 'not_connected', `${identity.userId} must remain disconnected after another identity connects`)
    const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: identity.headers })
    assert.deepEqual(subscriptions.json().subscriptions, [], `${identity.userId} must not see any of another identity's subscriptions`)
  }
})
