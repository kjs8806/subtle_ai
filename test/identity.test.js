import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createGoogleProvider } from '../server/auth/googleProvider.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'
import { createSessionManager } from '../server/security/session.js'
import { createTokenVault } from '../server/security/tokenVault.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Both OAuth callbacks are reached via a real top-level browser navigation, so
// they always redirect back to '/' rather than return a JSON body - the
// outcome is carried as a query param (auth_error / gmail_error) instead.
const errorFromRedirect = (response, param) => {
  const [, query] = (response.headers.location || '').split('?')
  return new URLSearchParams(query || '').get(param)
}

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
  // A gmail.readonly-only token carries no OIDC claims, so the real provider
  // identifies the connected mailbox by email (via Gmail's own profile
  // endpoint), not by subject - this mirrors that contract.
  exchangeGmailAuthorizationCode: async ({ code }) => {
    const subject = code.replace('mock-gmail:', '')
    return { status: 'authorized', email: `${subject}@example.com`, refreshToken: 'mock-gmail-refresh-token' }
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
  assert.equal(callback.statusCode, 302)
  assert.equal(callback.headers.location, '/')
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

// SEC-005/SEC-006 require exercising the *real* createGoogleProvider() implementation
// (not the fake used above) end to end: token exchange -> Google identity lookup ->
// normalized provider result -> application callback -> subject comparison ->
// encrypted token persistence. This harness drives that real implementation through a
// stubbed fetchImpl and records every URL it contacts, so tests can assert both what
// got persisted and whether Google was ever actually called.
const REAL_OIDC_REDIRECT = 'https://app.example/oidc'
const REAL_GMAIL_REDIRECT = 'https://app.example/gmail'

const createRealGoogleProvider = ({ signInSubject = GOOGLE_SUBJECT_A, gmailSubject = signInSubject, gmailRefreshToken = 'real-gmail-refresh-token', gmailTokenOk = true, revokeResponses = [] } = {}) => {
  const calls = []
  let revokeCallIndex = 0
  const fetchImpl = async (url, options = {}) => {
    calls.push(url)
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(options.body)
      const redirectUri = body.get('redirect_uri')
      if (redirectUri === REAL_OIDC_REDIRECT) return { ok: true, json: async () => ({ access_token: 'signin-access-token', token_type: 'Bearer', expires_in: 3600 }) }
      if (redirectUri === REAL_GMAIL_REDIRECT) {
        if (!gmailTokenOk) return { ok: false, status: 400 }
        return { ok: true, json: async () => ({ access_token: 'gmail-access-token', ...(gmailRefreshToken ? { refresh_token: gmailRefreshToken } : {}), token_type: 'Bearer', expires_in: 3600 }) }
      }
      throw new Error(`Unexpected redirect_uri ${redirectUri}`)
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return { ok: true, json: async () => ({ sub: signInSubject, email: `${signInSubject}@example.com`, name: 'Test User' }) }
    // A gmail.readonly-only token carries no OIDC claims, so the real provider
    // identifies the connected mailbox via Gmail's own profile endpoint, not
    // Google's tokeninfo (which returns no sub/user-identifying field for it).
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return { ok: true, json: async () => ({ emailAddress: `${gmailSubject}@example.com` }) }
    if (url === 'https://oauth2.googleapis.com/revoke') {
      const response = revokeResponses[revokeCallIndex] || { ok: true }
      revokeCallIndex += 1
      return response
    }
    throw new Error(`Unexpected fetch to ${url}`)
  }
  const provider = createGoogleProvider({ clientId: 'client', clientSecret: 'secret', oidcRedirectUri: REAL_OIDC_REDIRECT, gmailRedirectUri: REAL_GMAIL_REDIRECT, fetchImpl })
  return { provider, calls }
}

const authenticateReal = async (app) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=real-authorization-code`, cookies: { subtle_oauth_state: state } })
  assert.equal(callback.statusCode, 302)
  assert.equal(callback.headers.location, '/')
  const token = callback.cookies.find(({ name }) => name === 'subtle_session').value
  const headers = { cookie: `subtle_session=${token}` }
  const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  return { token, headers, user: me.json().user }
}

const connectGmailReal = async (app, headers) => {
  const start = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: { ...headers, ...sameOrigin } })
  const state = start.cookies.find(({ name }) => name === 'subtle_gmail_oauth_state').value
  return app.inject({
    method: 'GET',
    url: `/api/v1/sources/gmail/callback?state=${state}&code=real-gmail-authorization-code`,
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
  assert.equal(response.statusCode, 302)
  assert.equal(response.headers.location, '/')
  const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(source.json().status, 'connected')
})

test('Gmail OAuth with a different Google subject is rejected as identity_mismatch', async () => {
  const app = buildApp({ provider: createTestProvider(), gmailProvider: 'google' })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  const response = await connectGmail(app, headers, GOOGLE_SUBJECT_B)
  assert.equal(response.statusCode, 302)
  assert.equal(errorFromRedirect(response, 'gmail_error'), 'identity_mismatch')
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
  // The default mock scan scenario (server/gmail/fakeProvider.js) produces
  // six receipts (Netflix, Spotify, Dropbox, Disney+, YouTube Premium,
  // ChatGPT Plus), not one.
  assert.equal(subsA.json().subscriptions.length, 6)
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

    assert.equal(callback.statusCode, 302, `subject ${JSON.stringify(subject)} must be rejected`)
    assert.equal(errorFromRedirect(callback, 'auth_error'), 'missing_subject')
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
  assert.equal(callback.statusCode, 302)
  assert.equal(errorFromRedirect(callback, 'auth_error'), 'missing_subject')
  assert.equal(callback.cookies.find(({ name }) => name === 'subtle_session'), undefined)
})

test('SEC-002: Gmail OAuth with a missing, null, empty, or whitespace-only email cannot connect, persists no refresh token, and leaves scanning unavailable', async () => {
  for (const email of [undefined, null, '', '   ']) {
    const { repository, counts } = withCallCounts(createMemoryRepository())
    const provider = createTestProvider({ exchangeGmailAuthorizationCode: async () => ({ status: 'authorized', email, refreshToken: 'never-store' }) })
    const app = buildApp({ repository, provider, gmailProvider: 'google' })
    const { headers, user } = await authenticate(app, GOOGLE_SUBJECT_A)

    const response = await connectGmail(app, headers, GOOGLE_SUBJECT_A)
    assert.equal(response.statusCode, 302, `email ${JSON.stringify(email)} must be rejected`)
    assert.equal(errorFromRedirect(response, 'gmail_error'), 'identity_mismatch')
    assert.equal(counts.authorizeConnection, 0, 'authorizeConnection() must not run for a rejected Gmail identity')

    const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
    assert.equal(connection.json().status, 'not_connected')
    assert.equal(await repository.getEncryptedRefreshToken(user.id), null)

    const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: { ...headers, ...sameOrigin } })
    assert.equal(scan.statusCode, 409, 'scanning must remain unavailable after a rejected Gmail identity')
    assert.equal(scan.json().error.code, 'source_not_connected')
  }
})

test('SEC-002: a different (non-matching) Gmail subject is rejected without invoking authorizeConnection', async () => {
  const { repository, counts } = withCallCounts(createMemoryRepository())
  const app = buildApp({ repository, provider: createTestProvider(), gmailProvider: 'google' })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)

  const response = await connectGmail(app, headers, GOOGLE_SUBJECT_B)
  assert.equal(response.statusCode, 302)
  assert.equal(errorFromRedirect(response, 'gmail_error'), 'identity_mismatch')
  assert.equal(counts.authorizeConnection, 0)

  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: { ...headers, ...sameOrigin } })
  assert.equal(scan.statusCode, 409)
  assert.equal(scan.json().error.code, 'source_not_connected')
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

test('SEC-005: the real Google provider adapter connects Gmail through the application callback when the subject matches and persists an encrypted, non-empty refresh token', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const { provider, calls } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A, gmailSubject: GOOGLE_SUBJECT_A, gmailRefreshToken: 'real-gmail-refresh-token' })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })

  const { headers, user } = await authenticateReal(app)
  const response = await connectGmailReal(app, headers)
  assert.equal(response.statusCode, 302)
  assert.equal(response.headers.location, '/')
  const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(source.json().status, 'connected')

  const stored = await repository.getEncryptedRefreshToken(user.id)
  assert.ok(stored, 'a refresh token must be persisted')
  assert.equal(tokenVault.decrypt(stored), 'real-gmail-refresh-token')
  assert.ok(calls.includes('https://oauth2.googleapis.com/token'), 'the real token endpoint must have been called')
  assert.ok(calls.includes('https://gmail.googleapis.com/gmail/v1/users/me/profile'), 'the real Gmail identity lookup must have been called')
})

test('SEC-005: the real Google provider adapter rejects a mismatching Gmail subject through the application callback and persists nothing', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const { provider } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A, gmailSubject: GOOGLE_SUBJECT_B })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })

  const { headers, user } = await authenticateReal(app)
  const response = await connectGmailReal(app, headers)
  assert.equal(response.statusCode, 302)
  assert.equal(errorFromRedirect(response, 'gmail_error'), 'identity_mismatch')
  assert.equal(await repository.getEncryptedRefreshToken(user.id), null)
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'not_connected')
})

test('SEC-005: a failed real Gmail token exchange never normalizes to authorized and connects nothing', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const { provider } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A, gmailTokenOk: false })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })

  const { headers, user } = await authenticateReal(app)
  const response = await connectGmailReal(app, headers)
  assert.equal(response.statusCode, 302)
  assert.ok(errorFromRedirect(response, 'gmail_error'), 'a failed token exchange must redirect with a gmail_error')
  assert.equal(await repository.getEncryptedRefreshToken(user.id), null)
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'not_connected')
})

test('SEC-006: first-time Gmail authorization without a refresh token does not create a falsely usable connection', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const { provider } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A, gmailRefreshToken: null })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })

  const { headers, user } = await authenticateReal(app)
  const response = await connectGmailReal(app, headers)
  assert.equal(response.statusCode, 302)
  assert.equal(errorFromRedirect(response, 'gmail_error'), 'missing_refresh_token')
  assert.equal(await repository.getEncryptedRefreshToken(user.id), null)
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'not_connected')
})

test('SEC-006: a reconnect where Google omits a new refresh token preserves the existing valid encrypted token instead of overwriting it', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const sessions = createSessionManager()

  const { provider: firstProvider } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A, gmailRefreshToken: 'first-refresh-token' })
  const appFirst = buildApp({ repository, provider: firstProvider, gmailProvider: 'google', tokenVault, sessions })
  const { headers, user } = await authenticateReal(appFirst)
  const first = await connectGmailReal(appFirst, headers)
  assert.equal(first.statusCode, 302)
  assert.equal(first.headers.location, '/')
  assert.equal(tokenVault.decrypt(await repository.getEncryptedRefreshToken(user.id)), 'first-refresh-token')

  // A reconnect (e.g. re-consent) where Google legitimately omits refresh_token
  // must reuse the existing valid token, not overwrite it with encrypted empty data.
  const { provider: secondProvider } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A, gmailRefreshToken: null })
  const appSecond = buildApp({ repository, provider: secondProvider, gmailProvider: 'google', tokenVault, sessions })
  const second = await connectGmailReal(appSecond, headers)
  assert.equal(second.statusCode, 302)
  assert.equal(second.headers.location, '/')
  const source = await appSecond.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(source.json().status, 'connected')
  assert.equal(tokenVault.decrypt(await repository.getEncryptedRefreshToken(user.id)), 'first-refresh-token')
})

test('SEC-006: disconnect with no stored refresh token fails closed, never contacts Google, and never reports disconnected', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const { provider, calls } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })
  const { headers } = await authenticateReal(app)

  // No Gmail connection was ever made, so there is no encrypted token to revoke.
  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.notEqual(response.statusCode, 200)
  assert.equal(response.json().error.code, 'revocation_failed')
  assert.equal(calls.includes('https://oauth2.googleapis.com/revoke'), false, 'Google must not be contacted without a usable token')
})

test('SEC-006: disconnect with an encrypted empty refresh token fails closed and does not purge the connection', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const { provider, calls } = createRealGoogleProvider({ signInSubject: GOOGLE_SUBJECT_A })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })
  const { headers, user } = await authenticateReal(app)
  // Simulate a corrupted/legacy connection whose stored ciphertext decrypts to ''.
  await repository.authorizeConnection(user.id, tokenVault.encrypt(''))

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.notEqual(response.statusCode, 200)
  assert.equal(response.json().error.code, 'revocation_failed')
  assert.equal(calls.includes('https://oauth2.googleapis.com/revoke'), false, 'Google must not be contacted with an empty token')
  const connection = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(connection.json().status, 'connected', 'a failed/unverifiable revocation must not purge the connection')
})

test('SEC-006: a failed disconnect purges neither the subscriptions nor the evidence created from a connected Gmail source', async () => {
  const repository = createMemoryRepository()
  const tokenVault = createTokenVault({ secret: 'a'.repeat(32) })
  const provider = createTestProvider({ revokeConnection: async () => ({ status: 'revocation_failed' }) })
  const app = buildApp({ repository, provider, gmailProvider: 'google', tokenVault })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await connectGmail(app, headers, GOOGLE_SUBJECT_A)
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: { ...headers, ...sameOrigin } })
  assert.equal(scan.statusCode, 200)
  const before = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(before.json().subscriptions.length, 6)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers: { ...headers, ...sameOrigin } })
  assert.notEqual(response.statusCode, 200)

  const after = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(after.json().subscriptions.length, 6, 'evidence-backed subscriptions must survive a failed disconnect')
})
