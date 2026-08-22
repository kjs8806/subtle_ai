// FEATURE-002 API/runtime-level tests: the new correction, rejection, and
// candidate-review endpoints exercised as real HTTP requests against
// buildApp(), including the mandatory account-isolation test (AC17) driven
// through the real identity path with two distinct Google subjects - see
// test/identity.test.js for the same harness pattern.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'

const GOOGLE_SUBJECT_A = '104857612345678901234'
const GOOGLE_SUBJECT_B = '211348800987654321000'

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
  const callback = await app.inject({
    method: 'GET',
    url: `/api/v1/auth/google/callback?state=${state}&code=mock-success:${subject}`,
    cookies: { subtle_oauth_state: state },
  })
  assert.equal(callback.statusCode, 302)
  const token = callback.cookies.find(({ name }) => name === 'subtle_session').value
  const headers = { cookie: `subtle_session=${token}` }
  const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  return { headers, user: me.json().user }
}

const scanWithMessages = async (app, headers, messages) => {
  // The mock provider is fixed at buildApp() construction time, so scanning
  // custom messages means building the app with a provider stub whose
  // listCandidateMessages returns exactly these - callers pass a pre-built
  // app for that reason.
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 200, JSON.stringify(scan.json()))
  return scan.json()
}

test('PATCH /subscriptions/:id applies a correction, labels it distinctly, and GET reflects it thereafter', async () => {
  const provider = { ...createTestProvider(), listCandidateMessages: async () => [{ id: 'netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of USD $22.99 renews Sep 12, 2026.' }] }
  const app = buildApp({ provider })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  await scanWithMessages(app, headers)
  const subs = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  const subscriptionId = subs.json().subscriptions[0].id

  const patch = await app.inject({ method: 'PATCH', url: `/api/v1/subscriptions/${subscriptionId}`, headers, payload: { field: 'currentPrice', value: 24.99 } })
  assert.equal(patch.statusCode, 200, JSON.stringify(patch.json()))
  assert.equal(patch.json().currentPrice, 24.99)
  assert.equal(patch.json().corrections.find((c) => c.field === 'current_price').value, 24.99)

  const detail = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers })
  assert.equal(detail.json().currentPrice, 24.99, 'the correction persists across a fresh read')

  const invalidField = await app.inject({ method: 'PATCH', url: `/api/v1/subscriptions/${subscriptionId}`, headers, payload: { field: 'notAField', value: 1 } })
  assert.equal(invalidField.statusCode, 400)
  const invalidCurrency = await app.inject({ method: 'PATCH', url: `/api/v1/subscriptions/${subscriptionId}`, headers, payload: { field: 'currency', value: 'EUR' } })
  assert.equal(invalidCurrency.statusCode, 400)
})

test('POST /subscriptions/:id/reject removes it from the default listing and spend, non-destructively', async () => {
  const provider = { ...createTestProvider(), listCandidateMessages: async () => [{ id: 'netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of USD $22.99 renews Sep 12, 2026.' }] }
  const app = buildApp({ provider })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  await scanWithMessages(app, headers)
  const before = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  const subscriptionId = before.json().subscriptions[0].id

  const reject = await app.inject({ method: 'POST', url: `/api/v1/subscriptions/${subscriptionId}/reject`, headers, payload: {} })
  assert.equal(reject.statusCode, 200)
  assert.equal(reject.json().status, 'rejected')

  const after = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(after.json().subscriptions.length, 0, 'a rejected subscription disappears from the default listing')

  const detail = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers })
  assert.equal(detail.statusCode, 200, 'the rejected record is still inspectable directly by id, not deleted')
  assert.equal(detail.json().evidence.length, 1, 'evidence is preserved, not destroyed')
})

test('the ambiguous-candidate review endpoints: list, confirm, and reject', async () => {
  const provider = { ...createTestProvider(), listCandidateMessages: async () => [{ id: 'gym-1', subject: 'Payment receipt', sender: 'billing@downtownfitness.example', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your payment was received.' }] }
  const app = buildApp({ provider })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  const scan = await scanWithMessages(app, headers)
  assert.equal(scan.ambiguous, 1)

  const subsBefore = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subsBefore.json().subscriptions.length, 0, 'an ambiguous message never creates a confirmed subscription')

  const candidates = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/candidates', headers })
  assert.equal(candidates.statusCode, 200)
  assert.equal(candidates.json().candidates.length, 1)
  const candidateId = candidates.json().candidates[0].id
  assert.equal(candidates.json().candidates[0].evidence.length, 1)

  const confirm = await app.inject({ method: 'POST', url: `/api/v1/subscriptions/candidates/${candidateId}/confirm`, headers, payload: {} })
  assert.equal(confirm.statusCode, 200, JSON.stringify(confirm.json()))
  const subsAfter = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
  assert.equal(subsAfter.json().subscriptions.length, 1, 'confirming creates exactly one subscription')

  const candidatesAfter = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/candidates', headers })
  assert.equal(candidatesAfter.json().candidates.length, 0, 'a confirmed candidate is no longer pending')

  const doubleConfirm = await app.inject({ method: 'POST', url: `/api/v1/subscriptions/candidates/${candidateId}/confirm`, headers, payload: {} })
  assert.equal(doubleConfirm.statusCode, 409)

  const missing = await app.inject({ method: 'POST', url: '/api/v1/subscriptions/candidates/00000000-0000-0000-0000-000000000000/reject', headers, payload: {} })
  assert.equal(missing.statusCode, 404)
})

test('rejecting a candidate stops there permanently: no subscription is created and it stays out of the pending list', async () => {
  const provider = { ...createTestProvider(), listCandidateMessages: async () => [{ id: 'gym-1', subject: 'Payment receipt', sender: 'billing@downtownfitness.example', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your payment was received.' }] }
  const app = buildApp({ provider })
  const { headers } = await authenticate(app, GOOGLE_SUBJECT_A)
  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  await scanWithMessages(app, headers)
  const candidates = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/candidates', headers })
  const candidateId = candidates.json().candidates[0].id

  const reject = await app.inject({ method: 'POST', url: `/api/v1/subscriptions/candidates/${candidateId}/reject`, headers, payload: {} })
  assert.equal(reject.statusCode, 200)
  assert.equal(reject.json().status, 'rejected')

  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/subscriptions/candidates', headers })).json().candidates.length, 0)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })).json().subscriptions.length, 0)
})

// AC17 (mandatory, per the Founder): exercised at the real HTTP/identity
// level, not substituted with a repository-only test. Two distinct realistic
// Google `sub` values resolve to two distinct internal users.id via
// resolveOrCreateIdentity; user B's PATCH/reject calls against user A's real
// subscription id must be rejected, and user A's own correction must survive
// untouched.
test('AC17: account isolation holds for corrections and rejection at the real API/identity level', async () => {
  const repository = createMemoryRepository()
  const provider = { ...createTestProvider(), listCandidateMessages: async () => [{ id: 'netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of USD $22.99 renews Sep 12, 2026.' }] }
  const app = buildApp({ repository, provider })

  const userA = await authenticate(app, GOOGLE_SUBJECT_A)
  const userB = await authenticate(app, GOOGLE_SUBJECT_B)
  assert.notEqual(userA.user.id, userB.user.id)

  await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: userA.headers, payload: {} })
  await scanWithMessages(app, userA.headers)
  const subsA = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userA.headers })
  assert.equal(subsA.json().subscriptions.length, 1)
  const subscriptionId = subsA.json().subscriptions[0].id

  // User A corrects it successfully.
  const ownCorrection = await app.inject({ method: 'PATCH', url: `/api/v1/subscriptions/${subscriptionId}`, headers: userA.headers, payload: { field: 'plan', value: 'Premium' } })
  assert.equal(ownCorrection.statusCode, 200)
  assert.equal(ownCorrection.json().plan, 'Premium')

  // User B attempts to PATCH and reject user A's real subscription id.
  const forbiddenPatch = await app.inject({ method: 'PATCH', url: `/api/v1/subscriptions/${subscriptionId}`, headers: userB.headers, payload: { field: 'currentPrice', value: 1 } })
  assert.equal(forbiddenPatch.statusCode, 404, 'user B receives not-found, per existing API conventions, not the record')
  const forbiddenReject = await app.inject({ method: 'POST', url: `/api/v1/subscriptions/${subscriptionId}/reject`, headers: userB.headers, payload: {} })
  assert.equal(forbiddenReject.statusCode, 404)

  // User B also cannot see it in their own listing or by id.
  const subsB = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: userB.headers })
  assert.equal(subsB.json().subscriptions.length, 0)
  const getB = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers: userB.headers })
  assert.equal(getB.statusCode, 404)

  // Re-read as user A: no field changed, and the original correction is intact.
  const stillA = await app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers: userA.headers })
  assert.equal(stillA.statusCode, 200)
  assert.equal(stillA.json().status, 'active', "user B's reject attempt did not change user A's subscription status")
  assert.equal(stillA.json().currentPrice, 22.99, "user B's patch attempt did not change user A's subscription price")
  assert.equal(stillA.json().plan, 'Premium', "user A's own correction is still intact")
  assert.equal(stillA.json().corrections.find((c) => c.field === 'plan').value, 'Premium')
})
