import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'

// Both OAuth callbacks are reached via a real top-level browser navigation, so
// they always redirect back to '/' rather than return a JSON body - the
// outcome is carried as a query param (auth_error / gmail_error) instead.
const errorFromRedirect = (response, param) => {
  const [, query] = (response.headers.location || '').split('?')
  return new URLSearchParams(query || '').get(param)
}

const authorize = async (app) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?state=${state}&code=mock-success`,
    cookies: { subtle_oauth_state: state },
  })
  assert.equal(callback.statusCode, 302)
  assert.equal(callback.headers.location, '/')
  return callback.cookies.find(({ name }) => name === 'subtle_session').value
}

// Gmail authorization is a separate, explicit step from sign-in (never
// implied by it - see server/app.js's callback and
// docs/product/features/FEATURE-001.md), so scan-focused tests that need a
// connected source as fixture state must ask for it explicitly rather than
// relying on sign-in to have connected it for them.
const authorizeAndConnect = async (app) => {
  const session = await authorize(app)
  const headers = { cookie: `subtle_session=${session}` }
  const connect = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  assert.equal(connect.statusCode, 200)
  return session
}

test('health reports the mock provider', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.json(), { status: 'ok', provider: 'mock' })
})

test('sets browser security headers', async () => {
  const response = await buildApp().inject({ method: 'GET', url: '/api/v1/health' })
  assert.match(response.headers['content-security-policy'], /default-src 'self'/)
  assert.equal(response.headers['x-content-type-options'], 'nosniff')
})

test('production mutations reject cross-site and missing origins', async () => {
  const app = buildApp({ production: true, publicOrigin: 'https://subtle.example' })
  const missing = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' })
  const crossSite = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { origin: 'https://attacker.example' } })
  assert.equal(missing.statusCode, 403)
  assert.equal(crossSite.statusCode, 403)
  assert.equal(crossSite.json().error.code, 'invalid_origin')
})

test('expired oauth state is rejected', async () => {
  let time = 0
  const app = buildApp({ now: () => time })
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  time = 10 * 60 * 1000 + 1
  const response = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=mock-success`, cookies: { subtle_oauth_state: state } })
  assert.equal(response.statusCode, 302)
  assert.equal(errorFromRedirect(response, 'auth_error'), 'invalid_oauth_state')
})

test('rejects protected routes without a session', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/api/v1/subscriptions' })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'unauthenticated')
})

test('mock authorization and scan create evidence-backed subscriptions idempotently', async () => {
  const app = buildApp()
  const session = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${session}` }
  const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(source.json().status, 'connected')

  // The default mock scenario (server/gmail/fakeProvider.js) models a small
  // multi-service inbox - one receipt each for Netflix, Spotify, Dropbox,
  // Disney+, and YouTube Premium, plus two ChatGPT Plus receipts (so it has a
  // price history), plus two weak-signal receipts (iCloud+, Microsoft 365)
  // that land as ambiguous candidates rather than subscriptions - so a fresh
  // mock sign-in has more than a single row to show, and exercises both the
  // "needs a decision" recommendation engine and ambiguous-candidate review.
  const firstScan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(firstScan.statusCode, 200)
  assert.equal(firstScan.json().found, 7)
  assert.equal(firstScan.json().ambiguous, 2)
  const secondScan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(secondScan.json().found, 0)

  const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subscriptions.json().subscriptions.length, 6)
  const detail = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptions.json().subscriptions[0].id}`, headers })
  assert.equal(detail.json().evidence.length, 1)
  assert.equal(detail.json().fieldObservations.find(({ field }) => field === 'amount').provenance, 'confirmed')
})

test('concurrent scans for the same connection are rejected with a conflict', async () => {
  const app = buildApp()
  const session = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${session}` }
  await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })

  const [first, second] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers }),
    app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers }),
  ])
  const statuses = [first.statusCode, second.statusCode].sort()
  assert.deepEqual(statuses, [200, 409])
  const conflict = first.statusCode === 409 ? first : second
  assert.equal(conflict.json().error.code, 'scan_already_running')

  const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subscriptions.json().subscriptions.length, 6)
})

test('scan persists only subscription-classified receipts from a mixed mailbox', async () => {
  const messages = [
    { id: 'netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of USD $22.99 renews Sep 12, 2026.' },
    { id: 'uber-1', subject: 'Your Uber trip receipt', sender: 'receipts@uber.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Thanks for riding with Uber. Trip fare $18.42.' },
    { id: 'lyft-1', subject: 'Your Lyft ride receipt', sender: 'no-reply@lyft.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your Lyft ride receipt. Total $14.71.' },
    { id: 'amazon-1', subject: 'Your Amazon order has shipped', sender: 'ship-confirm@amazon.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your Amazon order has shipped.' },
    { id: 'generic-1', subject: 'Payment receipt', sender: 'billing@example.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your payment was received.' },
  ]
  const provider = { ...createFakeGmailProvider(), listCandidateMessages: async () => messages }
  const app = buildApp({ provider })
  const session = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${session}` }

  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 200)
  assert.equal(scan.json().found, 1, 'only the Netflix renewal should be persisted')
  assert.equal(scan.json().ambiguous, 1, 'the generic payment-receipt message is ambiguous, not one_time')

  const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subscriptions.json().subscriptions.length, 1)
  assert.equal(subscriptions.json().subscriptions[0].canonicalService, 'Netflix')
  assert.equal(subscriptions.json().subscriptions[0].currency, 'USD')
})

// FEATURE-001 currency completion gap: currency is part of the minimum
// evidence required for automatic creation, alongside subscription
// classification and amount. See docs/engineering/FEATURE_001_CURRENCY.md.
const scanSingleMessage = async (message) => {
  const provider = { ...createFakeGmailProvider(), listCandidateMessages: async () => [message] }
  const app = buildApp({ provider })
  const session = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${session}` }
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  return { scan: scan.json(), subscriptions: subscriptions.json().subscriptions }
}

test('Case A: an explicit USD renewal auto-creates with currency USD persisted', async () => {
  const { scan, subscriptions } = await scanSingleMessage({ id: 'case-a', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly membership renewal is USD $22.99.' })
  assert.equal(scan.found, 1)
  assert.equal(subscriptions.length, 1)
  assert.equal(subscriptions[0].currency, 'USD')
  assert.equal(subscriptions[0].currentPrice, 22.99)
})

test('Case B: an explicit CAD renewal auto-creates with currency CAD persisted', async () => {
  const { scan, subscriptions } = await scanSingleMessage({ id: 'case-b', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly membership renewal is CAD $22.99.' })
  assert.equal(scan.found, 1)
  assert.equal(subscriptions.length, 1)
  assert.equal(subscriptions[0].currency, 'CAD')
  assert.equal(subscriptions[0].currentPrice, 22.99)
})

test('Case C: an unresolved bare-$ renewal is ambiguous, not auto-created as fully confirmed', async () => {
  const { scan, subscriptions } = await scanSingleMessage({ id: 'case-c', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly membership renewal is $22.99.' })
  assert.equal(scan.found, 0)
  assert.equal(scan.ambiguous, 1)
  assert.equal(subscriptions.length, 0)
})

test('Case D: an unsupported currency (EUR) is never auto-created and never falsely resolves to USD', async () => {
  const { scan, subscriptions } = await scanSingleMessage({ id: 'case-d', subject: 'Membership renewal', sender: 'billing@example.eu', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly subscription renewal is EUR 19.99' })
  assert.equal(scan.found, 0)
  assert.equal(subscriptions.length, 0)
})

test('disconnect prevents future scans', async () => {
  const app = buildApp()
  const session = await authorize(app)
  const headers = { cookie: `subtle_session=${session}` }
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(response.statusCode, 409)
  assert.equal(response.json().error.code, 'source_not_connected')
})

test('gmail identity mismatch does not connect the source', async () => {
  const provider = {
    ...createFakeGmailProvider(),
    exchangeAuthorizationCode: async () => ({ status: 'authorized', subject: 'signed-in-subject', email: 'user@example.com', refreshToken: 'mock-refresh-token' }),
    exchangeGmailAuthorizationCode: async () => ({ status: 'authorized', subject: 'different-google-subject', refreshToken: 'never-store' }),
  }
  const app = buildApp({ provider, gmailProvider: 'google' })
  const session = await authorize(app)
  const start = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: { cookie: `subtle_session=${session}`, origin: 'http://127.0.0.1:5173' } })
  const state = start.cookies.find(({ name }) => name === 'subtle_gmail_oauth_state').value
  const response = await app.inject({ method: 'GET', url: `/api/v1/sources/gmail/callback?state=${state}&code=mock-success`, headers: { cookie: `subtle_session=${session}; subtle_gmail_oauth_state=${state}` } })
  assert.equal(response.statusCode, 302)
  assert.equal(errorFromRedirect(response, 'gmail_error'), 'identity_mismatch')
  const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers: { cookie: `subtle_session=${session}` } })
  assert.equal(source.json().status, 'not_connected')
})

test('secure mode issues session and oauth-state cookies with HttpOnly, Secure, and SameSite=Lax', async () => {
  const app = buildApp({ production: true, publicOrigin: 'https://subtle.example' })
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const stateCookie = start.cookies.find(({ name }) => name === 'subtle_oauth_state')
  assert.equal(stateCookie.httpOnly, true)
  assert.equal(stateCookie.secure, true)
  assert.equal(stateCookie.sameSite, 'Lax')

  const state = stateCookie.value
  const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=mock-success`, cookies: { subtle_oauth_state: state } })
  const sessionCookie = callback.cookies.find(({ name }) => name === 'subtle_session')
  assert.equal(sessionCookie.httpOnly, true)
  assert.equal(sessionCookie.secure, true)
  assert.equal(sessionCookie.sameSite, 'Lax')
})

test('secure mode issues the Gmail OAuth-state cookie with HttpOnly, Secure, and SameSite=Lax', async () => {
  const app = buildApp({ production: true, publicOrigin: 'https://subtle.example' })
  const session = await authorize(app)
  const start = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: { cookie: `subtle_session=${session}`, origin: 'https://subtle.example' } })
  const gmailStateCookie = start.cookies.find(({ name }) => name === 'subtle_gmail_oauth_state')
  assert.ok(gmailStateCookie, 'expected a subtle_gmail_oauth_state cookie')
  assert.equal(gmailStateCookie.httpOnly, true)
  assert.equal(gmailStateCookie.secure, true)
  assert.equal(gmailStateCookie.sameSite, 'Lax')
})

test('GMAIL_PROVIDER=google activates cookie/origin hardening even when NODE_ENV is not production', async () => {
  // The controlled Codespaces validation environment is served over HTTPS but may
  // not set NODE_ENV=production, so this protection must not depend solely on it.
  const app = buildApp({ gmailProvider: 'google', production: false, publicOrigin: 'https://codespace.example' })
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const stateCookie = start.cookies.find(({ name }) => name === 'subtle_oauth_state')
  assert.equal(stateCookie.secure, true)

  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/logout' })
  assert.equal(response.statusCode, 403)
  assert.equal(response.json().error.code, 'invalid_origin')
})

test('same-origin enforcement covers every state-changing endpoint: valid origin accepted, missing and foreign origin rejected', async () => {
  const app = buildApp({ production: true, publicOrigin: 'https://subtle.example' })
  const mutations = [
    '/api/v1/auth/logout',
    '/api/v1/sources/gmail/authorize',
    '/api/v1/sources/gmail/scan',
    '/api/v1/sources/gmail/disconnect',
  ]
  for (const url of mutations) {
    const missing = await app.inject({ method: 'POST', url })
    assert.equal(missing.statusCode, 403, `${url} must reject a missing Origin`)
    assert.equal(missing.json().error.code, 'invalid_origin')

    const foreign = await app.inject({ method: 'POST', url, headers: { origin: 'https://attacker.example' } })
    assert.equal(foreign.statusCode, 403, `${url} must reject a foreign Origin`)
    assert.equal(foreign.json().error.code, 'invalid_origin')

    const sameOrigin = await app.inject({ method: 'POST', url, headers: { origin: 'https://subtle.example' } })
    assert.notEqual(sameOrigin.statusCode, 403, `${url} must accept a matching Origin`)
  }
})

test('source responses never expose token custody fields', async () => {
  const repository = createMemoryRepository()
  const app = buildApp({ repository, tokenVault: { encrypt: () => 'encrypted-refresh-token' } })
  const session = await authorize(app)
  const response = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers: { cookie: `subtle_session=${session}` } })
  assert.equal(response.statusCode, 200)
  assert.equal('encryptedRefreshToken' in response.json(), false)
})

test('invalid oauth state is rejected', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/google/callback?state=bad&code=mock-success' })
  assert.equal(response.statusCode, 302)
  assert.equal(errorFromRedirect(response, 'auth_error'), 'invalid_oauth_state')
})

test('oauth state cannot be reused', async () => {
  const app = buildApp()
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const url = `/api/v1/auth/google/callback?state=${state}&code=mock-success`
  const first = await app.inject({ method: 'GET', url, cookies: { subtle_oauth_state: state } })
  const second = await app.inject({ method: 'GET', url, cookies: { subtle_oauth_state: state } })
  assert.equal(first.statusCode, 302)
  assert.equal(first.headers.location, '/')
  assert.equal(second.statusCode, 302)
  assert.equal(errorFromRedirect(second, 'auth_error'), 'invalid_oauth_state')
})

test('GET /api/v1/attention requires a session, then surfaces a durable price change and a dismissible renewal', async () => {
  const app = buildApp()
  const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/attention' })
  assert.equal(unauthenticated.statusCode, 401)

  const session = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${session}` }
  await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 200)

  // The mock mailbox (server/gmail/fakeProvider.js) has a ChatGPT Plus price
  // rise from $16.00 to $20.00 (25%, well past the >=5%-or->=$24/yr
  // threshold) and several explicit renewal dates within the 30-day window.
  const first = await app.inject({ method: 'GET', url: '/api/v1/attention', headers })
  assert.equal(first.statusCode, 200)
  const items = first.json().items
  const priceItem = items.find((item) => item.type === 'price_change')
  assert.ok(priceItem, 'the ChatGPT Plus price increase surfaces as an attention item')
  assert.equal(priceItem.priceChange.previousPrice, 16)
  assert.equal(priceItem.priceChange.currentPrice, 20)
  assert.ok(items.some((item) => item.type === 'renewal'), 'at least one renewal within 30 days surfaces')

  const dismiss = await app.inject({
    method: 'POST',
    url: `/api/v1/attention/${encodeURIComponent(priceItem.id)}/dismiss`,
    headers: { ...headers, origin: 'http://127.0.0.1:5173' },
  })
  assert.equal(dismiss.statusCode, 200)

  const second = await app.inject({ method: 'GET', url: '/api/v1/attention', headers })
  assert.ok(!second.json().items.some((item) => item.id === priceItem.id), 'a dismissed item no longer appears')
})
