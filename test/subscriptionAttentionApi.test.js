// FEATURE-003 API/runtime-level tests for GET /api/v1/subscriptions/attention:
// wire-shape (plain decimal amounts, never cents), the fixed 3-tier
// priority/sort, rejected-subscription exclusion, and the mandatory account
// -isolation test driven through the real identity path - same harness
// pattern as test/subscriptionCorrectionsApi.test.js's AC17 test.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'

const GOOGLE_SUBJECT_A = '104857612345678901234'
const GOOGLE_SUBJECT_B = '211348800987654321000'
const NOW = Date.parse('2026-01-01T00:00:00.000Z')

const createTestProvider = (extra = {}) => ({
  ...createFakeGmailProvider(),
  exchangeAuthorizationCode: async ({ code }) => {
    const subject = code.replace('mock-success:', '')
    return { status: 'authorized', subject, email: `${subject}@example.com`, refreshToken: 'mock-refresh-token' }
  },
  ...extra,
})

const authenticate = async (app, subject) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=mock-success:${subject}`, cookies: { subtle_oauth_state: state } })
  assert.equal(callback.statusCode, 302)
  const token = callback.cookies.find(({ name }) => name === 'subtle_session').value
  const headers = { cookie: `subtle_session=${token}` }
  const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  return { headers, user: me.json().user }
}

// Netflix's second receipt both raises the price materially AND states an
// explicit renewal date 18 days out - a single subscription legitimately
// produces two distinct attention items (one of each type), which this test
// deliberately exercises rather than avoids.
const NETFLIX_INCREASE_MESSAGES = [
  { id: 'netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2025-11-19T09:00:00.000Z', body: 'Your monthly payment of USD $19.99 renews Dec 19, 2025.' },
  { id: 'netflix-2', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2025-12-19T09:00:00.000Z', body: 'Your monthly payment of USD $22.99 renews Jan 19, 2026.' },
]
const NORDVPN_SOON_MESSAGE = { id: 'nordvpn-1', subject: 'NordVPN renewal receipt', sender: 'billing@nordvpn.com', receivedAt: '2025-01-05T09:00:00.000Z', body: 'Your annual payment of USD $119.99 renews Jan 05, 2026.' }

test('GET /subscriptions/attention returns evidence-backed items in the fixed 3-tier priority order, with a currency-explicit wire shape', async () => {
  const provider = { ...createTestProvider(), listCandidateMessages: async () => [...NETFLIX_INCREASE_MESSAGES, NORDVPN_SOON_MESSAGE] }
  const app = buildApp({ provider, now: () => NOW })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 200, JSON.stringify(scan.json()))

  const response = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/attention', headers })
  assert.equal(response.statusCode, 200)
  const { items } = response.json()
  assert.equal(items.length, 3, 'NordVPN renewal + Netflix price increase + Netflix renewal')

  // Tier 1: renewal within 7 days (NordVPN, 4 days out) comes first.
  assert.equal(items[0].type, 'renewal')
  assert.equal(items[0].canonicalService, 'NordVPN')
  assert.equal(items[0].bucket, 'soon')
  assert.equal(items[0].certainty, 'confirmed')
  assert.equal(items[0].renewalDate, '2026-01-05')
  assert.equal(items[0].amount, 119.99)
  assert.equal(items[0].cadence, 'yearly')
  assert.equal(items[0].currency, 'USD')
  assert.equal(items[0].priority, 'high')

  // Tier 2: material price increase (Netflix).
  assert.equal(items[1].type, 'price_increase')
  assert.equal(items[1].canonicalService, 'Netflix')
  assert.equal(items[1].currency, 'USD')
  assert.equal(items[1].previousPrice, 19.99, 'wire amounts are plain decimals, not integer cents')
  assert.equal(items[1].currentPrice, 22.99)
  assert.equal(items[1].cadence, 'monthly')
  assert.equal(items[1].perPeriodIncrease, 3)
  assert.equal(items[1].annualizedIncrease, 36)
  assert.equal(items[1].priority, 'normal')
  assert.ok(items[1].evidenceId)
  assert.equal(items[1].ruleVersion, 'v1')
  assert.ok(items[1].detectedAt)

  // Tier 3: renewal 8-30 days out (Netflix's own stated renewal, 18 days).
  assert.equal(items[2].type, 'renewal')
  assert.equal(items[2].canonicalService, 'Netflix')
  assert.equal(items[2].bucket, 'upcoming')
  assert.equal(items[2].certainty, 'confirmed')
  assert.equal(items[2].renewalDate, '2026-01-19')
  assert.equal(items[2].priority, 'normal')
})

test('a rejected subscription never produces a price-change or renewal attention item', async () => {
  const provider = { ...createTestProvider(), listCandidateMessages: async () => NETFLIX_INCREASE_MESSAGES }
  const app = buildApp({ provider, now: () => NOW })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })

  const before = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/attention', headers })
  // This subscription produces both a price_increase item (material) and a
  // renewal item (its own stated renewal date, 18 days out) before rejection.
  assert.equal(before.json().items.length, 2, 'both a material price increase and a renewal item are present before rejection')
  assert.deepEqual(before.json().items.map((item) => item.type).sort(), ['price_increase', 'renewal'])

  const subs = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  const subscriptionId = subs.json().subscriptions[0].id
  const reject = await app.inject({ method: 'POST', url: `/api/v1/subscriptions/${subscriptionId}/reject`, headers, payload: {} })
  assert.equal(reject.statusCode, 200)

  const after = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/attention', headers })
  assert.deepEqual(after.json().items, [], 'a rejected subscription produces no attention item of either type')
})

test('a subscription with null currency/cadence/next_renewal loads safely and produces zero attention items', async () => {
  const provider = { ...createTestProvider(), listCandidateMessages: async () => [{ id: 'mystery-1', subject: 'Subscription receipt', sender: '"Mystery Service" <billing@mystery.example>', receivedAt: '2025-12-01T09:00:00.000Z', body: 'This subscription renews automatically. No amount or date is included in this notice.' }] }
  const app = buildApp({ provider, now: () => NOW })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 200)

  const subs = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subs.json().subscriptions.length, 1)
  const detail = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subs.json().subscriptions[0].id}`, headers })
  assert.equal(detail.statusCode, 200, 'a subscription with no supported evidence still loads Subscription Detail without error')

  const attention = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/attention', headers })
  assert.equal(attention.statusCode, 200)
  assert.deepEqual(attention.json().items, [])
})

// AC-equivalent (mandatory): exercised at the real HTTP/identity level, not
// substituted with a repository-only test. Two distinct realistic Google
// `sub` values resolve to two distinct internal users.id via
// resolveOrCreateIdentity; user B's GET /attention must never reflect user
// A's price-change or renewal intelligence.
test('account isolation holds for GET /subscriptions/attention at the real API/identity level', async () => {
  const repository = createMemoryRepository()
  const provider = { ...createTestProvider(), listCandidateMessages: async () => NETFLIX_INCREASE_MESSAGES }
  const app = buildApp({ repository, provider, now: () => NOW })

  const userA = await authenticate(app, GOOGLE_SUBJECT_A)
  const userB = await authenticate(app, GOOGLE_SUBJECT_B)
  assert.notEqual(userA.user.id, userB.user.id)

  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: userA.headers, payload: {} })
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: userA.headers })

  const attentionA = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/attention', headers: userA.headers })
  assert.equal(attentionA.json().items.length, 2, 'a material price increase plus a renewal item for the same subscription')

  const attentionB = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/attention', headers: userB.headers })
  assert.equal(attentionB.statusCode, 200)
  assert.deepEqual(attentionB.json().items, [], "user B's attention feed reflects nothing from user A's subscriptions")

  const unauthenticated = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/attention' })
  assert.equal(unauthenticated.statusCode, 401)
})
