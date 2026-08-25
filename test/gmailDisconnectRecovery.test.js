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

test('CASE B: a genuine provider revocation failure never purges local data', async () => {
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
  assert.equal(response.json().error.code, 'revocation_failed')
  assert.equal(attempts(), 0, 'local purge must never run when revocation genuinely failed')

  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'connected', 'the source remains available for a retry')
  assert.equal(after.subscriptions.length, before.subscriptions.length, 'data is untouched')
})

test('CASE B (variant): a non-throwing but unsuccessful revocation result never purges local data either', async () => {
  const realRepository = createMemoryRepository()
  const { repository, attempts } = withFailingPurge(realRepository, 0)
  const provider = { ...createFakeGmailProvider(), revokeConnection: async () => ({ status: 'revocation_failed' }) }
  const app = buildApp({ repository, provider })
  const token = await authorizeAndConnect(app)
  const headers = { cookie: `subtle_session=${token}` }
  await seedGmailDerivedState(app, headers)

  const response = await app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
  assert.equal(response.statusCode, 502)
  assert.equal(attempts(), 0)
  const after = await gmailState(app, headers)
  assert.equal(after.source.status, 'connected')
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
