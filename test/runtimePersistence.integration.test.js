import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pool } from 'pg'
import { buildApp } from '../server/app.js'
import { createRuntime } from '../server/bootstrap.js'
import { runMigrations } from '../server/persistence/migrations.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'

// The Postgres `users.id` column is typed uuid (see migrations/001_feature_001.sql).
// server/app.js's OAuth callback writes the provider `subject` directly as that id
// (bypassing the auth_identities provider_subject -> internal id mapping the schema
// was built for), so subjects used here must be UUID-shaped or user creation 500s.
// This is a separate, out-of-scope defect from QA Defect 1 (runtime wiring) — see
// the completion report — so these tests route around it rather than fixing it.
const testUsers = {
  a: randomUUID(),
  b: randomUUID(),
  idempotency: randomUUID(),
  concurrent: randomUUID(),
}

const baseConnectionString = process.env.DATABASE_URL
const integration = baseConnectionString ? test : test.skip

// This suite runs the application through the same runtime/bootstrap composition
// root the real server uses (node server/app.js), never instantiating the
// PostgreSQL repository directly, to prove persistence survives a real restart.
const RUNTIME_DB_NAME = 'subtle_ai_test_runtime'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const withDatabaseName = (connectionString, dbName) => {
  const url = new URL(connectionString)
  url.pathname = `/${dbName}`
  return url.toString()
}

const waitForPool = async (connectionString) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pool = new Pool({ connectionString })
    try { await pool.query('SELECT 1'); return pool } catch (error) {
      await pool.end()
      if (attempt === 19) throw error
      await sleep(250)
    }
  }
}

const ensureIsolatedDatabase = async (adminConnectionString, dbName) => {
  const admin = await waitForPool(adminConnectionString)
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`)
  } finally {
    await admin.end()
  }
}

// exchangeAuthorizationCode reads the intended subject out of the mock code itself,
// so a single app/provider instance can authenticate multiple distinct identities —
// needed to prove account isolation against one running server, not one per user.
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
  assert.equal(callback.statusCode, 200, `authentication failed for ${subject}`)
  return callback.cookies.find(({ name }) => name === 'subtle_session').value
}

integration('server runtime persists through restart, isolates accounts, purges Gmail data, stays idempotent, and rejects concurrent scans', async (t) => {
  const runtimeUrl = withDatabaseName(baseConnectionString, RUNTIME_DB_NAME)
  await ensureIsolatedDatabase(baseConnectionString, RUNTIME_DB_NAME)

  const reset = await waitForPool(runtimeUrl)
  await reset.query('DROP SCHEMA public CASCADE')
  await reset.query('CREATE SCHEMA public')
  await reset.end()

  const settings = { persistenceProvider: 'postgres', databaseUrl: runtimeUrl, gmailProvider: 'mock' }

  await t.test('A: bootstrap, authenticate, connect Gmail, scan a mock receipt, and read it back through the API', async () => {
    const runtimeA = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const session = await authenticate(runtimeA.app, testUsers.a)
    const headers = { cookie: `subtle_session=${session}` }

    const connect = await runtimeA.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers })
    assert.equal(connect.json().status, 'connected')

    const scan = await runtimeA.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
    assert.equal(scan.statusCode, 200)
    assert.equal(scan.json().found, 1)

    const subs = await runtimeA.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    assert.equal(subs.json().subscriptions.length, 1)
    const detail = await runtimeA.app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subs.json().subscriptions[0].id}`, headers })
    assert.equal(detail.json().evidence.length, 1)

    // Seed a manual (non-Gmail-derived) subscription directly, the way an
    // approved manual entry would be persisted — no manual-entry API exists yet.
    const direct = await waitForPool(runtimeUrl)
    await direct.query('INSERT INTO subscriptions (user_id, canonical_service, raw_merchant, source) VALUES ($1, $2, $3, $4)', [testUsers.a, 'Manual Gym', 'manual', 'Manual entry'])
    await direct.end()

    await runtimeA.close()
  })

  let subscriptionId
  await t.test('B: bootstrap a fresh app instance against the same database and verify data survived the restart, with account isolation intact', async () => {
    const runtimeB = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const session = await authenticate(runtimeB.app, testUsers.a)
    const headers = { cookie: `subtle_session=${session}` }

    const subs = await runtimeB.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    assert.equal(subs.json().subscriptions.length, 2)
    const gmailSub = subs.json().subscriptions.find((s) => s.source === 'Gmail receipt')
    assert.ok(gmailSub)
    subscriptionId = gmailSub.id
    const detail = await runtimeB.app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers })
    assert.equal(detail.json().evidence.length, 1)

    const otherSession = await authenticate(runtimeB.app, testUsers.b)
    const otherHeaders = { cookie: `subtle_session=${otherSession}` }
    const otherSubs = await runtimeB.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: otherHeaders })
    assert.equal(otherSubs.json().subscriptions.length, 0)
    const forbidden = await runtimeB.app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers: otherHeaders })
    assert.equal(forbidden.statusCode, 404)

    const disconnect = await runtimeB.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
    assert.equal(disconnect.statusCode, 200)

    await runtimeB.close()
  })

  await t.test('C: bootstrap again after disconnect and verify Gmail-derived data was purged while the manual subscription remains', async () => {
    const runtimeC = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const session = await authenticate(runtimeC.app, testUsers.a)
    const headers = { cookie: `subtle_session=${session}` }

    const subs = await runtimeC.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    const remaining = subs.json().subscriptions
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].source, 'Manual entry')

    await runtimeC.close()
  })

  await t.test('idempotency: processing the same provider message twice across a restart creates no duplicates', async () => {
    const runtimeD = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const sessionD = await authenticate(runtimeD.app, testUsers.idempotency)
    const headersD = { cookie: `subtle_session=${sessionD}` }
    await runtimeD.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: headersD })
    const firstScan = await runtimeD.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: headersD })
    assert.equal(firstScan.json().found, 1)
    await runtimeD.close()

    const runtimeE = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const sessionE = await authenticate(runtimeE.app, testUsers.idempotency)
    const headersE = { cookie: `subtle_session=${sessionE}` }
    const secondScan = await runtimeE.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: headersE })
    assert.equal(secondScan.statusCode, 200)
    assert.equal(secondScan.json().found, 0)

    const subs = await runtimeE.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: headersE })
    assert.equal(subs.json().subscriptions.length, 1)
    assert.equal(subs.json().subscriptions[0].billingHistory.length, 1)
    assert.equal(subs.json().subscriptions[0].evidence.length, 1)
    await runtimeE.close()
  })

  await t.test('concurrency: two simultaneous scans for the same connection produce one accepted scan and one 409, with no duplicate processing', async () => {
    const slowProvider = createTestProvider({
      listCandidateMessages: async () => { await sleep(250); return [{ id: 'mock-message-netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of $22.99 renews Sep 12, 2026.' }] },
    })
    const runtimeF = await createRuntime(buildApp, settings, { provider: slowProvider })
    const sessionF = await authenticate(runtimeF.app, testUsers.concurrent)
    const headersF = { cookie: `subtle_session=${sessionF}` }
    await runtimeF.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: headersF })

    const [first, second] = await Promise.all([
      runtimeF.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: headersF }),
      runtimeF.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: headersF }),
    ])
    const statuses = [first.statusCode, second.statusCode].sort()
    assert.deepEqual(statuses, [200, 409])
    const conflict = first.statusCode === 409 ? first : second
    const winner = first.statusCode === 200 ? first : second
    assert.equal(conflict.json().error.code, 'scan_already_running')
    assert.equal(winner.json().found, 1)

    const subs = await runtimeF.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: headersF })
    assert.equal(subs.json().subscriptions.length, 1)
    await runtimeF.close()
  })

  await t.test('migration failure aborts startup and leaves the database in a state that a subsequent valid startup can recover', async () => {
    const brokenDir = await mkdtemp(join(tmpdir(), 'subtle-ai-broken-migration-'))
    try {
      await writeFile(join(brokenDir, '999_broken.sql'), 'CREATE TABLE this is not valid sql;')
      const pool = new Pool({ connectionString: runtimeUrl })
      try {
        await assert.rejects(runMigrations({ pool, directory: brokenDir }))
        const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', ['999'])
        assert.equal(applied.rowCount, 0)
      } finally {
        await pool.end()
      }

      const recovered = await createRuntime(buildApp, settings, { provider: createTestProvider() })
      const response = await recovered.app.inject({ method: 'GET', url: '/api/v1/health' })
      assert.equal(response.statusCode, 200)
      await recovered.close()
    } finally {
      await rm(brokenDir, { recursive: true, force: true })
    }
  })
})
