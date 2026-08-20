import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'

const authorize = async (app) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?state=${state}&code=mock-success`,
    cookies: { subtle_oauth_state: state },
  })
  assert.equal(callback.statusCode, 200)
  return callback.cookies.find(({ name }) => name === 'subtle_session').value
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
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error.code, 'invalid_oauth_state')
})

test('rejects protected routes without a session', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/api/v1/subscriptions' })
  assert.equal(response.statusCode, 401)
  assert.equal(response.json().error.code, 'unauthenticated')
})

test('mock authorization and scan create one evidence-backed subscription idempotently', async () => {
  const app = buildApp()
  const session = await authorize(app)
  const headers = { cookie: `subtle_session=${session}` }
  const source = await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })
  assert.equal(source.json().status, 'connected')

  const firstScan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(firstScan.statusCode, 200)
  assert.equal(firstScan.json().found, 1)
  const secondScan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(secondScan.json().found, 0)

  const subscriptions = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subscriptions.json().subscriptions.length, 1)
  const detail = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptions.json().subscriptions[0].id}`, headers })
  assert.equal(detail.json().evidence.length, 1)
  assert.equal(detail.json().fieldObservations.find(({ field }) => field === 'amount').provenance, 'confirmed')
})

test('fake authorization URL completes the session-producing callback route', async () => {
  const app = buildApp()
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  assert.match(start.json().url, /^\/api\/v1\/auth\/google\/callback\?/)
  const callback = await app.inject({
    method: 'GET',
    url: start.json().url,
    cookies: { subtle_oauth_state: state },
  })
  assert.equal(callback.statusCode, 200)
  assert.ok(callback.cookies.some(({ name }) => name === 'subtle_session'))
})

test('authorization cancellation and provider failure are distinct', async () => {
  const cancelledProvider = {
    createAuthorizationRequest: ({ state }) => ({ url: `/api/v1/auth/google/callback?state=${state}&code=cancel` }),
    exchangeAuthorizationCode: async () => ({ status: 'cancelled' }),
  }
  const cancelledApp = buildApp({ provider: cancelledProvider })
  const cancelledStart = await cancelledApp.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const cancelledState = cancelledStart.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const cancelled = await cancelledApp.inject({ method: 'GET', url: cancelledStart.json().url, cookies: { subtle_oauth_state: cancelledState } })
  assert.equal(cancelled.statusCode, 400)
  assert.equal(cancelled.json().error.code, 'cancelled')

  const failedProvider = { ...cancelledProvider, exchangeAuthorizationCode: async () => { throw new Error('provider unavailable') } }
  const failedApp = buildApp({ provider: failedProvider })
  const failedStart = await failedApp.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const failedState = failedStart.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const failed = await failedApp.inject({ method: 'GET', url: failedStart.json().url, cookies: { subtle_oauth_state: failedState } })
  assert.equal(failed.statusCode, 502)
  assert.equal(failed.json().error.code, 'authorization_failed')
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

test('invalid oauth state is rejected', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/api/v1/auth/google/callback?state=bad&code=mock-success' })
  assert.equal(response.statusCode, 400)
  assert.equal(response.json().error.code, 'invalid_oauth_state')
})

test('oauth state cannot be reused', async () => {
  const app = buildApp()
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const url = `/api/v1/auth/google/callback?state=${state}&code=mock-success`
  const first = await app.inject({ method: 'GET', url, cookies: { subtle_oauth_state: state } })
  const second = await app.inject({ method: 'GET', url, cookies: { subtle_oauth_state: state } })
  assert.equal(first.statusCode, 200)
  assert.equal(second.statusCode, 400)
})