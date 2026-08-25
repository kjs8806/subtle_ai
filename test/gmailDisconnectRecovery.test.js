// MVP-BETA-004 (#41, Tech Lead remediation on PR #51): Disconnect Gmail must
// be recoverable when remote revocation succeeds but the local purge that
// follows it fails. Before this fix, the disconnect route unconditionally
// called provider.revokeConnection() on every attempt - a retry after a
// purge failure would revoke an already-revoked token, which a real
// provider can legitimately reject, permanently blocking the user from ever
// finishing disconnect. CASE A/B/C below match the Tech Lead review's
// required scenarios exactly.
import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { Pool } from 'pg'
import { buildApp } from '../server/app.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'
import { createPostgresRepository } from '../server/persistence/postgresRepository.js'
import { runMigrations } from '../server/persistence/migrations.js'
import { createTokenVault } from '../server/security/tokenVault.js'

const authorize = async (app) => {
  const start = await app.inject({ method: 'GET', url: '/api/v1/auth/google/start' })
  const state = start.cookies.find(({ name }) => name === 'subtle_oauth_state').value
  const callback = await app.inject({ method: 'GET', url: `/api/v1/auth/google/callback?state=${state}&code=mock-success`, cookies: { subtle_oauth_state: state } })
  assert.equal(callback.statusCode, 302)
  return callback.cookies.find(({ name }) => name === 'subtle_session').value
}

// Gmail authorization is a separate, explicit step from sign-in (never
// implied by it - see server/app.js's OIDC callback and
// docs/product/features/FEATURE-001.md), so every test below that needs a
// connected source as fixture state asks for it explicitly rather than
// relying on sign-in to have connected it, matching test/server.test.js's
// authorizeAndConnect convention.
const authorizeAndConnect = async (app) => {
  const token = await authorize(app)
  const headers = { cookie: `subtle_session=${token}` }
  const connect = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers, payload: {} })
  assert.equal(connect.statusCode, 200)
  return token
}

// Wraps a real repository so its disconnectConnection can be made to fail on
// its first N calls before delegating to the real implementation - the
// repository interface has no concept of injectable failure, so this is the
// same technique the account-deletion tests already use for
// provider.revokeConnection overrides, applied one layer down.
const withFailingPurge = (realRepository, failures = 1) => {
  let attempts = 0
  return {
    repository: { ...realRepository, disconnectConnection: (userId) => {
      attempts += 1
      if (attempts <= failures) throw new Error('simulated transient local purge failure')
      return realRepository.disconnectConnection(userId)
    } },
    attempts: () => attempts,
  }
}

// SEC-041-01 (Security Manager remediation on PR #51): the same technique as
// withFailingPurge above, one layer earlier - makes
// repository.markGmailRevoked fail on its first N calls (simulating a
// transient DB error landing *after* provider.revokeConnection() has already
// returned successful revocation, but before that confirmation is durably
// recorded) before delegating to the real implementation.
const withFailingMarkRevoked = (realRepository, failures = 1) => {
  let attempts = 0
  return {
    repository: { ...realRepository, markGmailRevoked: (userId) => {
      attempts += 1
      if (attempts <= failures) throw new Error('simulated transient markGmailRevoked failure')
      return realRepository.markGmailRevoked(userId)
    } },
    attempts: () => attempts,
  }
}

const countingRevoke = (result = { status: 'disconnected' }) => {
  let calls = 0
  return { fn: async () => { calls += 1; return typeof result === 'function' ? result() : result }, calls: () => calls }
}

// Uses the fake provider's default scan scenario (server/gmail/fakeProvider.js),
// which produces real subscriptions, an evidence-backed price change (two
// ChatGPT Plus receipts at different prices), and at least one ambiguous
// pending candidate (iCloud+/Microsoft 365) in a single scan - the same real
// mix Gmail disconnect purge (#41) already has coverage for, reused here so
// this test proves the *recovery* behavior against real, non-trivial state
// rather than an empty account.
const seedGmailDerivedState = async (app, headers) => {
  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 200)
  assert.ok(scan.json().found > 0, 'test setup expected the mock scan to produce subscriptions')
  assert.ok(scan.json().ambiguous > 0, 'test setup expected the mock scan to produce an ambiguous candidate')
}

const gmailState = async (app, headers) => ({
  source: (await app.inject({ method: 'GET', url: '/api/v1/sources/gmail', headers })).json(),
  subscriptions: (await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })).json().subscriptions,
  candidates: (await app.inject({ method: 'GET', url: '/api/v1/subscriptions/candidates', headers })).json().candidates,
  attention: (await app.inject({ method: 'GET', url: '/api/v1/attention', headers })).json().items,
})

test('CASE A: a local purge failure after confirmed remote revocation is recoverable without a second successful provider revocation', async () => {
  const realRepository = createMemoryRepository()
  const { repository, attempts } = withFailingPurge(realRepository, 1)
  const revoke = countingRevoke()
  const provider = { ...createFakeGmailProvider(), revokeConnection: revoke.fn }
  const app = buildApp({ repository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)

  const before = await gmailState(app, headers)
  assert.ok(before.subscriptions.length > 0 && before.candidates.length > 0)

  // First attempt: revocation succeeds, purge is made to fail.
  const first = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(first.statusCode, 502)
  assert.equal(first.json().error.code, 'purge_failed')
  assert.equal(revoke.calls(), 1)

  // A failed purge must never look like a successful, still-usable
  // connection, and must never partially delete data.
  const afterFirst = await gmailState(app, headers)
  assert.notEqual(afterFirst.source.status, 'connected')
  assert.equal(afterFirst.subscriptions.length, before.subscriptions.length, 'a failed purge must not partially delete subscriptions')
  assert.equal(afterFirst.candidates.length, before.candidates.length, 'a failed purge must not partially delete candidates')

  // Retry: must succeed WITHOUT a second provider revocation call.
  const retry = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(retry.statusCode, 200)
  assert.equal(retry.json().status, 'not_connected')
  assert.equal(revoke.calls(), 1, 'retry must not call provider.revokeConnection a second time')
  assert.equal(attempts(), 2, 'the purge itself was attempted twice (once failed, once succeeded)')

  // Full verification, matching the review's required checklist.
  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'not_connected', 'source disconnected')
  assert.equal(await realRepository.getEncryptedRefreshToken((await app.inject({ method: 'GET', url: '/api/v1/session', headers })).json().user.id), null, 'local Gmail credentials gone')
  assert.deepEqual(after.subscriptions, [], 'Gmail subscriptions gone')
  assert.deepEqual(after.candidates, [], 'candidates gone')
  assert.deepEqual(after.attention, [], 'dependent FEATURE-003 attention state gone')

  // Account remains usable (account/identity remain, unrelated behavior unaffected).
  const session = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  assert.equal(session.json().authenticated, true, 'the account itself remains')
})

// SEC-041-02 (Security Manager remediation on PR #51): a provider that
// THROWS represents an ambiguous transport/network outcome, not a
// definitive one - the request may never have reached Google, or it may
// have been processed successfully with the response lost in transit. This
// used to be conflated with a genuine rejection and reverted the connection
// to 'connected' (cancelGmailDisconnect), which risked reporting a healthy,
// scannable connection for a token that might already be dead at Google.
// See CASE F below for the full ambiguous-outcome recovery story (retry,
// purge, user isolation) - this test only proves the immediate response.
test('CASE B: an ambiguous (thrown) provider outcome never purges local data and never reactivates the connection', async () => {
  const realRepository = createMemoryRepository()
  const { repository, attempts } = withFailingPurge(realRepository, 0)
  const provider = { ...createFakeGmailProvider(), revokeConnection: async () => { throw new Error('Google is unreachable') } }
  const app = buildApp({ repository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)
  const before = await gmailState(app, headers)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(response.statusCode, 502)
  assert.equal(response.json().error.code, 'revocation_uncertain')
  assert.equal(attempts(), 0, 'local purge must never run while the revocation outcome is ambiguous')

  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'revoke_requested', 'an ambiguous outcome must never reactivate the connection back to connected')
  assert.equal(after.subscriptions.length, before.subscriptions.length, 'data is untouched')

  const scan = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scan.statusCode, 409, 'scanning must remain blocked while the revocation outcome is ambiguous')
})

// The counterpart to CASE B: a provider that returns a normal, explicit
// {status: 'revocation_failed'} result (not a throw) is giving a genuinely
// definitive answer - a completed exchange with Google that came back
// rejected. This is "an explicit provider failure case" the fix must still
// let follow the pre-existing, safe behavior: revert to 'connected' so the
// connection remains usable for a retry, exactly as before SEC-041-02.
test('CASE B (variant): a non-throwing, explicit unsuccessful revocation result is definitive and never purges local data, and correctly reverts to connected', async () => {
  const realRepository = createMemoryRepository()
  const { repository, attempts } = withFailingPurge(realRepository, 0)
  const provider = { ...createFakeGmailProvider(), revokeConnection: async () => ({ status: 'revocation_failed' }) }
  const app = buildApp({ repository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(response.statusCode, 502)
  assert.equal(response.json().error.code, 'revocation_failed')
  assert.equal(attempts(), 0)
  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'connected', 'a definitive rejection safely reverts to connected, unlike an ambiguous outcome')
})

test('CASE C: a normal, first-try-successful disconnect is unchanged', async () => {
  const realRepository = createMemoryRepository()
  const revoke = countingRevoke()
  const provider = { ...createFakeGmailProvider(), revokeConnection: revoke.fn }
  const app = buildApp({ repository: realRepository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().status, 'not_connected')
  assert.equal(revoke.calls(), 1)

  const after = await gmailState(app, headers)
  assert.deepEqual(after.subscriptions, [])
  assert.deepEqual(after.candidates, [])
})

// SEC-041-01 (Security Manager remediation on PR #51): CASE A above proved
// recovery from a *purge* failure after confirmed revocation. This is the
// gap CASE A's own fix didn't cover - repository.markGmailRevoked, the write
// that *records* confirmed revocation, can itself fail. Before this fix that
// silently left the connection back at 'connected' with a token already
// dead at Google, and a retry would call provider.revokeConnection() again
// from scratch with no record a disconnect had ever been attempted.
test('CASE D: a markGmailRevoked failure after confirmed remote revocation is absorbed in-process, without any second provider revocation call', async () => {
  const realRepository = createMemoryRepository()
  // Exactly one failure: the in-process retry (server/app.js's withRetries,
  // 3 attempts) must absorb this within the same request.
  const { repository, attempts } = withFailingMarkRevoked(realRepository, 1)
  const revoke = countingRevoke()
  const provider = { ...createFakeGmailProvider(), revokeConnection: revoke.fn }
  const app = buildApp({ repository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)
  const before = await gmailState(app, headers)
  assert.ok(before.subscriptions.length > 0 && before.candidates.length > 0)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })

  assert.equal(response.statusCode, 200, 'a single transient markGmailRevoked failure must be fully absorbed within one request')
  assert.equal(response.json().status, 'not_connected')
  assert.equal(revoke.calls(), 1, 'the in-process retry must never call provider.revokeConnection a second time')
  assert.equal(attempts(), 2, 'markGmailRevoked was attempted twice within the one request (once failed, once succeeded)')

  // Full verification, matching the required post-recovery checklist.
  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'not_connected', 'source no longer connected')
  const session = (await app.inject({ method: 'GET', url: '/api/v1/session', headers })).json()
  assert.equal(session.authenticated, true, 'the account itself remains')
  assert.equal(await realRepository.getEncryptedRefreshToken(session.user.id), null, 'stored Gmail credentials are gone')
  const scanAttempt = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scanAttempt.statusCode, 409, 'scanning cannot run until explicit reconnection')
  assert.equal(scanAttempt.json().error.code, 'source_not_connected')
  assert.deepEqual(after.subscriptions, [], 'Gmail subscriptions/evidence gone')
  assert.deepEqual(after.candidates, [], 'candidates/corrections gone')
  assert.deepEqual(after.attention, [], 'FEATURE-003 dependent state gone')
})

// The complementary crash-boundary case: the in-process retry budget itself
// is exhausted (modeling a markGmailRevoked failure that outlives the whole
// request, or the process crashing before any retry can run at all). The
// connection must land somewhere safe and recoverable - never silently back
// at 'connected' - and a *subsequent* request must still be able to finish,
// even though that now requires a second (safe, idempotent) provider call.
test('CASE E: exhausting the markGmailRevoked retry budget leaves the connection safely recoverable on a subsequent request', async () => {
  const realRepository = createMemoryRepository()
  // 3 failures exactly fills the in-process retry budget (3 attempts) on the
  // first request; the 4th attempt (on a second, separate request) succeeds.
  const { repository, attempts } = withFailingMarkRevoked(realRepository, 3)
  const revoke = countingRevoke()
  const provider = { ...createFakeGmailProvider(), revokeConnection: revoke.fn }
  const app = buildApp({ repository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)
  const before = await gmailState(app, headers)

  const first = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(first.statusCode, 502)
  assert.equal(first.json().error.code, 'revocation_confirmation_failed')
  assert.equal(revoke.calls(), 1, 'the first request must not fall back to a second provider call on its own')
  assert.equal(attempts(), 3, 'all 3 in-process retry attempts were exhausted')

  // A failed-but-confirmed-revocation must never look like a successful,
  // still-usable connection, and must never partially delete data.
  const afterFirst = await gmailState(app, headers)
  assert.notEqual(afterFirst.source.status, 'connected', 'the connection must not look normal/still-connected after a confirmed-but-unrecorded revocation')
  const scanAttempt = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scanAttempt.statusCode, 409, 'scanning must already be blocked in this ambiguous window, before the write that records confirmed revocation ever succeeds')
  assert.equal(afterFirst.subscriptions.length, before.subscriptions.length, 'no partial deletion')
  assert.equal(afterFirst.candidates.length, before.candidates.length, 'no partial deletion')

  const retry = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(retry.statusCode, 200, 'a subsequent request must still be able to complete recovery')
  assert.equal(retry.json().status, 'not_connected')
  assert.equal(revoke.calls(), 2, 'recovery from an exhausted retry budget may safely call the provider again - it is designed to be a safe no-op on an already-revoked token')
  assert.equal(attempts(), 4)

  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'not_connected')
  const session = (await app.inject({ method: 'GET', url: '/api/v1/session', headers })).json()
  assert.equal(session.authenticated, true, 'the account itself remains')
  assert.equal(await realRepository.getEncryptedRefreshToken(session.user.id), null, 'stored Gmail credentials are gone')
  assert.deepEqual(after.subscriptions, [], 'Gmail subscriptions/evidence gone')
  assert.deepEqual(after.candidates, [], 'candidates/corrections gone')
  assert.deepEqual(after.attention, [], 'FEATURE-003 dependent state gone')
})

// SEC-041-02 (Security Manager remediation on PR #51): the provider's own
// contract for an ambiguous transport outcome (see
// server/auth/googleProvider.js's revokeConnection: a thrown fetch
// exception, not a completed HTTP response) is `{status:
// 'revocation_ambiguous'}` - distinct from both 'disconnected' and the
// definitive 'revocation_failed'. This models "network response loss after
// a simulated successful provider-side revocation": Google may well have
// processed the revocation, but the confirmation never made it back, so the
// application must treat this exactly as uncertain, never as either
// outcome.
test('CASE F: an ambiguous transport outcome (network response lost) leaves the source in revoke_requested, never connected, and a retry completes disconnect and purge', async () => {
  const realRepository = createMemoryRepository()
  let calls = 0
  const provider = { ...createFakeGmailProvider(), revokeConnection: async () => { calls += 1; return calls === 1 ? { status: 'revocation_ambiguous' } : { status: 'disconnected' } } }
  const app = buildApp({ repository: realRepository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)
  const session = (await app.inject({ method: 'GET', url: '/api/v1/session', headers })).json()
  // authorizeAndConnect's mock-provider shortcut (server/app.js's
  // gmailProvider === 'mock' path) never actually stores a token - seed a
  // known one directly so this test can meaningfully assert it is *retained*
  // through the ambiguous outcome, not just trivially absent throughout.
  await realRepository.authorizeConnection(session.user.id, 'ambiguous-case-refresh-token')
  const before = await gmailState(app, headers)
  assert.ok(before.subscriptions.length > 0 && before.candidates.length > 0)
  assert.equal(await realRepository.getEncryptedRefreshToken(session.user.id), 'ambiguous-case-refresh-token', 'test setup did not actually seed a token')

  // First attempt: the provider-side outcome is genuinely ambiguous.
  const first = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(first.statusCode, 502, 'an ambiguous outcome must return a retryable error, not success')
  assert.equal(first.json().error.code, 'revocation_uncertain')
  assert.equal(calls, 1)

  // Never falsely reported as disconnected, never reactivated to connected,
  // scanning stays blocked, and the credential is retained server-side.
  const afterFirst = await gmailState(app, headers)
  assert.equal(afterFirst.source.status, 'revoke_requested', 'an ambiguous outcome must never be reported as connected or disconnected')
  assert.notEqual(afterFirst.source.status, 'connected')
  assert.notEqual(afterFirst.source.status, 'not_connected')
  const scanAttempt = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
  assert.equal(scanAttempt.statusCode, 409, 'scanning must remain blocked while the revocation outcome is ambiguous')
  assert.equal(scanAttempt.json().error.code, 'source_not_connected')
  assert.equal(await realRepository.getEncryptedRefreshToken(session.user.id), 'ambiguous-case-refresh-token', 'the encrypted refresh token must remain available server-side for recovery')
  assert.equal(afterFirst.subscriptions.length, before.subscriptions.length, 'no partial deletion while ambiguous')
  assert.equal(afterFirst.candidates.length, before.candidates.length, 'no partial deletion while ambiguous')

  // Retry: this time the provider gives a confirmed answer, and recovery completes.
  const retry = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(retry.statusCode, 200)
  assert.equal(retry.json().status, 'not_connected')
  assert.equal(calls, 2, 'the retry is expected to call the provider again - safe, since revoking an already-revoked token is a documented no-op')

  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'not_connected', 'source disconnected')
  assert.equal(await realRepository.getEncryptedRefreshToken(session.user.id), null, 'local Gmail credentials gone')
  assert.deepEqual(after.subscriptions, [], 'Gmail subscriptions gone')
  assert.deepEqual(after.candidates, [], 'candidates gone')
  assert.deepEqual(after.attention, [], 'dependent FEATURE-003 attention state gone')
  assert.equal(session.authenticated, true, 'the account itself remains')
})

// Reconnecting is the *other* legitimate way a stuck 'revoked_pending_purge'
// connection gets finished, in addition to retrying disconnect directly -
// repository.authorizeConnection self-heals it before establishing the new
// connection, so old Gmail-derived data can never silently coexist with data
// from the reconnected session.
const runSelfHealContractTest = (label, createRepository, testFn = test) => {
  testFn(`[${label}] reconnecting after a stuck revoked_pending_purge connection finishes the pending purge first`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-selfheal@example.com`, name: 'Self Heal' })
    await repository.authorizeConnection(user.id)
    const first = await repository.persistParsedEvidence(user.id, {
      sourceId: 'msg-1', canonicalService: 'Netflix', rawMerchant: 'billing', amount: 15, currency: 'USD', cadence: 'monthly', nextRenewal: '2026-09-15', receivedAt: '2026-08-19T09:00:00.000Z', confidence: { score: 0.9, state: 'confirmed' },
      fieldObservations: { canonicalService: { value: 'Netflix', provenance: 'confirmed' }, amount: { value: 15, provenance: 'confirmed' }, currency: { value: 'USD', provenance: 'confirmed' }, cadence: { value: 'monthly', provenance: 'confirmed' } },
      excerpt: 'Netflix receipt',
    })
    assert.ok(first.created)

    // Simulate exactly the stuck state: revocation confirmed, purge never completed.
    await repository.markGmailRevoked(user.id)
    const stuck = await repository.getConnection(user.id)
    assert.equal(stuck.status, 'revoked_pending_purge')
    assert.equal((await repository.listSubscriptions(user.id)).length, 1, 'the old data is still there while stuck')

    await repository.authorizeConnection(user.id)

    assert.equal((await repository.listSubscriptions(user.id)).length, 0, 'the stale pre-revocation subscription must be purged, not carried into the new connection')
    const reconnected = await repository.getConnection(user.id)
    assert.equal(reconnected.status, 'connected')
  })
}

runSelfHealContractTest('memory', async () => createMemoryRepository())

const baseConnectionString = process.env.DATABASE_URL
const DB_NAME = 'subtle_ai_test_disconnect_recovery'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const withDatabaseName = (connectionString, dbName) => { const url = new URL(connectionString); url.pathname = `/${dbName}`; return url.toString() }
const waitForPool = async (connectionString) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pool = new Pool({ connectionString })
    try { await pool.query('SELECT 1'); return pool } catch (error) { await pool.end(); if (attempt === 19) throw error; await sleep(250) }
  }
}

let pool
if (baseConnectionString) after(async () => { if (pool) await pool.end() })
const integration = baseConnectionString ? test : test.skip
runSelfHealContractTest('postgres', async () => {
  if (!pool) {
    const admin = await waitForPool(baseConnectionString)
    try {
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
      if (!exists.rowCount) await admin.query(`CREATE DATABASE "${DB_NAME}"`)
    } finally { await admin.end() }
    pool = await waitForPool(withDatabaseName(baseConnectionString, DB_NAME))
  }
  await pool.query('DROP SCHEMA public CASCADE')
  await pool.query('CREATE SCHEMA public')
  await runMigrations({ pool })
  return createPostgresRepository({ pool })
}, integration)

// The same CASE A end-to-end flow, against a real PostgreSQL-backed
// repository through the actual HTTP route - proves the recovery mechanism
// holds for the backend where the original foreign-key bug (migration 012)
// actually lived, not only for the in-memory backend.
integration('CASE A against PostgreSQL: local purge failure after confirmed remote revocation recovers on retry', async () => {
  const admin = await waitForPool(baseConnectionString)
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${DB_NAME}"`)
  } finally { await admin.end() }
  const pgPool = await waitForPool(withDatabaseName(baseConnectionString, DB_NAME))
  try {
    await pgPool.query('DROP SCHEMA public CASCADE')
    await pgPool.query('CREATE SCHEMA public')
    await runMigrations({ pool: pgPool })
    const realRepository = createPostgresRepository({ pool: pgPool })
    const { repository, attempts } = withFailingPurge(realRepository, 1)
    const revoke = countingRevoke()
    // Unlike the memory-backend tests above, this needs a real
    // resolveOrCreateIdentity-created UUID user (server/app.js's bare
    // 'mock-user' shortcut is a memory-repository convenience and is not a
    // valid `uuid` for the PostgreSQL users.id column) - a subject on the
    // exchange result is what makes the OIDC callback take that path.
    const provider = { ...createFakeGmailProvider(), exchangeAuthorizationCode: async () => ({ status: 'authorized', subject: 'pg-recovery-subject', email: 'pg-recovery@example.com', name: 'PG Recovery', refreshToken: 'mock-refresh-token' }), revokeConnection: revoke.fn }
    const app = buildApp({ repository, provider })
    const token = await authorizeAndConnect(app)
    const headers = { cookie: `subtle_session=${token}` }
    await seedGmailDerivedState(app, headers)

    const first = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
    assert.equal(first.statusCode, 502)
    assert.equal(first.json().error.code, 'purge_failed')
    assert.equal(revoke.calls(), 1)

    const stateRow = await pgPool.query('SELECT authorization_state, encrypted_refresh_token FROM source_connections WHERE user_id = (SELECT id FROM users LIMIT 1)')
    assert.equal(stateRow.rows[0].authorization_state, 'revoked_pending_purge')
    assert.equal(stateRow.rows[0].encrypted_refresh_token, null)

    const retry = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
    assert.equal(retry.statusCode, 200)
    assert.equal(revoke.calls(), 1, 'retry must not call provider.revokeConnection a second time')
    assert.equal(attempts(), 2)

    const subs = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    assert.deepEqual(subs.json().subscriptions, [])
    const candidates = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/candidates', headers })
    assert.deepEqual(candidates.json().candidates, [])
    assert.equal((await pgPool.query('SELECT count(*) FROM source_connections')).rows[0].count, '0')
    assert.equal((await pgPool.query('SELECT count(*) FROM users')).rows[0].count, '1', 'the account itself remains')
  } finally {
    await pgPool.end()
  }
})

// SEC-041-01, against a real PostgreSQL-backed repository: proves recovery
// from a repository.markGmailRevoked failure (the confirmed-revocation
// write itself, not the purge that follows it) holds for the backend where
// migration 012's original FK gap actually lived, and that a second,
// completely unrelated account's connection and Gmail-derived data are
// entirely unaffected by userA's recovery.
integration('CASE D against PostgreSQL: a markGmailRevoked failure after confirmed remote revocation recovers without corrupting another account', async () => {
  const admin = await waitForPool(baseConnectionString)
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${DB_NAME}"`)
  } finally { await admin.end() }
  const pgPool = await waitForPool(withDatabaseName(baseConnectionString, DB_NAME))
  try {
    await pgPool.query('DROP SCHEMA public CASCADE')
    await pgPool.query('CREATE SCHEMA public')
    await runMigrations({ pool: pgPool })
    const realRepository = createPostgresRepository({ pool: pgPool })
    const { repository, attempts } = withFailingMarkRevoked(realRepository, 1)
    const revoke = countingRevoke()
    const provider = { ...createFakeGmailProvider(), exchangeAuthorizationCode: async () => ({ status: 'authorized', subject: 'pg-recovery-subject-d', email: 'pg-recovery-d@example.com', name: 'PG Recovery D', refreshToken: 'mock-refresh-token' }), revokeConnection: revoke.fn }
    const app = buildApp({ repository, provider })
    const token = await authorizeAndConnect(app)
    const headers = { cookie: `subtle_session=${token}` }
    await seedGmailDerivedState(app, headers)
    const userA = (await app.inject({ method: 'GET', url: '/api/v1/session', headers })).json().user

    // A completely separate account, created directly through the
    // repository (bypassing the single-mock-subject HTTP OAuth stub above),
    // with its own Gmail-derived data - to prove userA's recovery cannot
    // touch it.
    const userB = await realRepository.createUser({ email: 'userb-secd@example.com', name: 'User B' })
    await realRepository.authorizeConnection(userB.id, createTokenVault({ secret: 'b'.repeat(32) }).encrypt('userb-refresh-token'))
    await realRepository.persistParsedEvidence(userB.id, { sourceId: 'userb-msg-1', canonicalService: 'Netflix', rawMerchant: 'billing', amount: 15, currency: 'USD', cadence: 'monthly', nextRenewal: '2026-09-15', receivedAt: '2026-08-19T09:00:00.000Z', confidence: { score: 0.9, state: 'confirmed' }, fieldObservations: { canonicalService: { value: 'Netflix', provenance: 'confirmed' }, amount: { value: 15, provenance: 'confirmed' }, currency: { value: 'USD', provenance: 'confirmed' }, cadence: { value: 'monthly', provenance: 'confirmed' } }, excerpt: 'userB receipt' })
    const userBBefore = { connection: await realRepository.getConnection(userB.id), subscriptions: await realRepository.listSubscriptions(userB.id) }
    assert.equal(userBBefore.connection.status, 'connected')
    assert.equal(userBBefore.subscriptions.length, 1)

    const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
    assert.equal(response.statusCode, 200, 'a single transient markGmailRevoked failure must be fully absorbed within one request')
    assert.equal(response.json().status, 'not_connected')
    assert.equal(revoke.calls(), 1, 'the in-process retry must never call provider.revokeConnection a second time')
    assert.equal(attempts(), 2)

    // Full verification for userA, matching the required post-recovery checklist.
    const subs = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    assert.deepEqual(subs.json().subscriptions, [], 'userA Gmail subscriptions/evidence gone')
    const candidates = await app.inject({ method: 'GET', url: '/api/v1/subscriptions/candidates', headers })
    assert.deepEqual(candidates.json().candidates, [], 'userA candidates/corrections gone')
    const scanAttempt = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
    assert.equal(scanAttempt.statusCode, 409, 'scanning cannot run until explicit reconnection')
    assert.equal((await pgPool.query('SELECT count(*) FROM source_connections WHERE user_id = $1', [userA.id])).rows[0].count, '0', 'userA Gmail credentials gone')
    assert.equal((await pgPool.query('SELECT count(*) FROM users WHERE id = $1', [userA.id])).rows[0].count, '1', 'the account itself remains')

    // userB's connection and data are completely untouched.
    const userBAfter = { connection: await realRepository.getConnection(userB.id), subscriptions: await realRepository.listSubscriptions(userB.id) }
    assert.equal(userBAfter.connection.status, 'connected', 'userB\'s connection must be untouched by userA\'s recovery')
    assert.equal(userBAfter.subscriptions.length, 1, 'userB\'s subscriptions must be untouched by userA\'s recovery')
    assert.equal(await realRepository.getEncryptedRefreshToken(userB.id) !== null, true, 'userB\'s Gmail credentials must be untouched by userA\'s recovery')
  } finally {
    await pgPool.end()
  }
})

// SEC-041-02, against a real PostgreSQL-backed repository: proves the
// ambiguous-transport-outcome recovery holds against the actual database
// backend (authorization_state, the encrypted token column), not only the
// in-memory model, and that a second, completely unrelated account is
// entirely unaffected throughout.
integration('CASE F against PostgreSQL: an ambiguous transport outcome leaves the source in revoke_requested, retains the credential, and a retry completes disconnect and purge without corrupting another account', async () => {
  const admin = await waitForPool(baseConnectionString)
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${DB_NAME}"`)
  } finally { await admin.end() }
  const pgPool = await waitForPool(withDatabaseName(baseConnectionString, DB_NAME))
  try {
    await pgPool.query('DROP SCHEMA public CASCADE')
    await pgPool.query('CREATE SCHEMA public')
    await runMigrations({ pool: pgPool })
    const realRepository = createPostgresRepository({ pool: pgPool })
    let calls = 0
    const provider = { ...createFakeGmailProvider(), exchangeAuthorizationCode: async () => ({ status: 'authorized', subject: 'pg-recovery-subject-f', email: 'pg-recovery-f@example.com', name: 'PG Recovery F', refreshToken: 'mock-refresh-token' }), revokeConnection: async () => { calls += 1; return calls === 1 ? { status: 'revocation_ambiguous' } : { status: 'disconnected' } } }
    const app = buildApp({ repository: realRepository, provider })
    const token = await authorizeAndConnect(app)
    const headers = { cookie: `subtle_session=${token}` }
    await seedGmailDerivedState(app, headers)
    const userA = (await app.inject({ method: 'GET', url: '/api/v1/session', headers })).json().user
    // authorizeAndConnect's mock-provider shortcut never stores a real
    // token - seed a known one directly so retention can be meaningfully
    // asserted (see the memory-backend CASE F for the same reasoning).
    const vault = createTokenVault({ secret: 'f'.repeat(32) })
    await realRepository.authorizeConnection(userA.id, vault.encrypt('ambiguous-case-pg-refresh-token'))

    // A completely separate account, unaffected throughout.
    const userB = await realRepository.createUser({ email: 'userb-secf@example.com', name: 'User B' })
    await realRepository.authorizeConnection(userB.id, vault.encrypt('userb-refresh-token'))
    await realRepository.persistParsedEvidence(userB.id, { sourceId: 'userb-msg-1', canonicalService: 'Netflix', rawMerchant: 'billing', amount: 15, currency: 'USD', cadence: 'monthly', nextRenewal: '2026-09-15', receivedAt: '2026-08-19T09:00:00.000Z', confidence: { score: 0.9, state: 'confirmed' }, fieldObservations: { canonicalService: { value: 'Netflix', provenance: 'confirmed' }, amount: { value: 15, provenance: 'confirmed' }, currency: { value: 'USD', provenance: 'confirmed' }, cadence: { value: 'monthly', provenance: 'confirmed' } }, excerpt: 'userB receipt' })

    // First attempt: ambiguous outcome.
    const first = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
    assert.equal(first.statusCode, 502)
    assert.equal(first.json().error.code, 'revocation_uncertain')
    assert.equal(calls, 1)

    const stateRow = await pgPool.query('SELECT authorization_state, encrypted_refresh_token, token_key_version FROM source_connections WHERE user_id = $1', [userA.id])
    assert.equal(stateRow.rows[0].authorization_state, 'revoke_requested', 'an ambiguous outcome must never be reported as connected or disconnected')
    assert.equal(vault.decrypt({ ciphertext: stateRow.rows[0].encrypted_refresh_token, keyVersion: stateRow.rows[0].token_key_version }), 'ambiguous-case-pg-refresh-token', 'the encrypted refresh token must remain available server-side for recovery')
    const scanAttempt = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
    assert.equal(scanAttempt.statusCode, 409, 'scanning must remain blocked while the revocation outcome is ambiguous')

    // Retry: this time the provider gives a confirmed answer, and recovery completes.
    const retry = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
    assert.equal(retry.statusCode, 200)
    assert.equal(calls, 2, 'the retry is expected to call the provider again - safe, since revoking an already-revoked token is a documented no-op')

    const subs = await app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    assert.deepEqual(subs.json().subscriptions, [], 'userA Gmail subscriptions/evidence gone')
    assert.equal((await pgPool.query('SELECT count(*) FROM source_connections WHERE user_id = $1', [userA.id])).rows[0].count, '0', 'userA Gmail credentials gone')
    assert.equal((await pgPool.query('SELECT count(*) FROM users WHERE id = $1', [userA.id])).rows[0].count, '1', 'the account itself remains')

    // userB's connection and data are completely untouched.
    const userBAfter = { connection: await realRepository.getConnection(userB.id), subscriptions: await realRepository.listSubscriptions(userB.id) }
    assert.equal(userBAfter.connection.status, 'connected', 'userB\'s connection must be untouched by userA\'s recovery')
    assert.equal(userBAfter.subscriptions.length, 1, 'userB\'s subscriptions must be untouched by userA\'s recovery')
    assert.equal(await realRepository.getEncryptedRefreshToken(userB.id) !== null, true, 'userB\'s Gmail credentials must be untouched by userA\'s recovery')
  } finally {
    await pgPool.end()
  }
})
