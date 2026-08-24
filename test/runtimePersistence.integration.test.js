import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Pool } from 'pg'
import { buildApp } from '../server/app.js'
import { createRuntime } from '../server/bootstrap.js'
import { runMigrations } from '../server/persistence/migrations.js'
import { createFakeGmailProvider } from '../server/gmail/fakeProvider.js'

// Realistic Google `sub` claims: opaque numeric strings, not UUIDs.
// repository.resolveOrCreateIdentity maps each one to an internally generated
// UUID users.id via auth_identities, so these do not need to be UUID-shaped.
const testUsers = {
  a: '104857612345678901234',
  b: '211348800987654321000',
  idempotency: '337722991100223344556',
  concurrent: '445566778899001122334',
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
  assert.equal(callback.statusCode, 302, `authentication failed for ${subject}`)
  assert.equal(callback.headers.location, '/')
  const session = callback.cookies.find(({ name }) => name === 'subtle_session').value
  const headers = { cookie: `subtle_session=${session}` }
  const me = await app.inject({ method: 'GET', url: '/api/v1/session', headers })
  return { session, headers, userId: me.json().user.id }
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
    const { headers, userId } = await authenticate(runtimeA.app, testUsers.a)

    const connect = await runtimeA.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers })
    assert.equal(connect.json().status, 'connected')

    const scan = await runtimeA.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers })
    assert.equal(scan.statusCode, 200)
    // The default mock scan scenario (server/gmail/fakeProvider.js) produces
    // seven evidence-backed receipts across six distinct subscriptions
    // (Netflix, Spotify, Dropbox, Disney+, YouTube Premium, and ChatGPT Plus
    // - which has two receipts at different prices), plus two ambiguous
    // receipts that don't count toward `found`.
    assert.equal(scan.json().found, 7)

    const subs = await runtimeA.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    assert.equal(subs.json().subscriptions.length, 6)
    assert.equal(subs.json().subscriptions[0].currency, 'USD')
    const detail = await runtimeA.app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subs.json().subscriptions[0].id}`, headers })
    assert.equal(detail.json().evidence.length, 1)
    assert.equal(detail.json().evidence[0].currency, 'USD')
    assert.equal(detail.json().priceHistory[0].currency, 'USD')
    assert.equal(detail.json().billingHistory[0].currency, 'USD')

    // Seed a manual (non-Gmail-derived) subscription directly, the way an
    // approved manual entry would be persisted — no manual-entry API exists yet.
    const direct = await waitForPool(runtimeUrl)
    await direct.query('INSERT INTO subscriptions (user_id, canonical_service, raw_merchant, source) VALUES ($1, $2, $3, $4)', [userId, 'Manual Gym', 'manual', 'Manual entry'])
    await direct.end()

    // FEATURE-003: the ChatGPT Plus receipt pair ($16.00 -> $20.00) is a
    // material price increase, so it must already have a durable event row
    // before any restart.
    const attention = await runtimeA.app.inject({ method: 'GET', url: '/api/v1/attention', headers })
    const priceItem = attention.json().items.find((item) => item.type === 'price_change')
    assert.ok(priceItem, 'the ChatGPT Plus price increase surfaces before any restart')
    const dismiss = await runtimeA.app.inject({ method: 'POST', url: `/api/v1/attention/${encodeURIComponent(priceItem.id)}/dismiss`, headers })
    assert.equal(dismiss.statusCode, 200)

    await runtimeA.close()
  })

  let subscriptionId
  let userIdA
  await t.test('B: bootstrap a fresh app instance against the same database and verify data survived the restart, with account isolation intact', async () => {
    const runtimeB = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const { headers, userId } = await authenticate(runtimeB.app, testUsers.a)
    // The Google subject resolves to the same internal user across a restart —
    // resolveOrCreateIdentity looked it up via auth_identities, not re-created it.
    userIdA = userId

    const subs = await runtimeB.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    assert.equal(subs.json().subscriptions.length, 7, 'six Gmail-derived plus the one seeded manual subscription')
    const gmailSub = subs.json().subscriptions.find((s) => s.source === 'Gmail receipt')
    assert.ok(gmailSub)
    assert.equal(gmailSub.currency, 'USD', 'currency survives the restart')
    subscriptionId = gmailSub.id
    const detail = await runtimeB.app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers })
    assert.equal(detail.json().evidence.length, 1)
    assert.equal(detail.json().evidence[0].currency, 'USD', 'evidence currency survives the restart')
    assert.equal(detail.json().priceHistory[0].currency, 'USD', 'price observation currency survives the restart')
    assert.equal(detail.json().billingHistory[0].currency, 'USD', 'billing event currency survives the restart')

    // FEATURE-003: the durable price_change_events row and the dismissal
    // recorded in step A both survive the restart - the event is not
    // re-created, and the dismissed item does not reappear.
    const eventRows = await waitForPool(runtimeUrl)
    const priceChangeCount = await eventRows.query('SELECT count(*) FROM price_change_events')
    assert.equal(priceChangeCount.rows[0].count, '1', 'the price-change event row persists through the restart, not duplicated')
    await eventRows.end()
    const attentionAfterRestart = await runtimeB.app.inject({ method: 'GET', url: '/api/v1/attention', headers })
    assert.equal(attentionAfterRestart.json().items.filter((item) => item.type === 'price_change').length, 0, 'the dismissal survives the restart')

    const { headers: otherHeaders } = await authenticate(runtimeB.app, testUsers.b)
    const otherSubs = await runtimeB.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: otherHeaders })
    assert.equal(otherSubs.json().subscriptions.length, 0)
    const forbidden = await runtimeB.app.inject({ method: 'GET', url: `/api/v1/subscriptions/${subscriptionId}`, headers: otherHeaders })
    assert.equal(forbidden.statusCode, 404)

    const disconnect = await runtimeB.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/disconnect', headers })
    assert.equal(disconnect.statusCode, 200)

    await runtimeB.close()
  })

  await t.test('C: bootstrap again after disconnect and verify Gmail-derived data was purged while the manual subscription remains, with identity mapping intact', async () => {
    const runtimeC = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const { headers, userId } = await authenticate(runtimeC.app, testUsers.a)
    assert.equal(userId, userIdA)

    const subs = await runtimeC.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers })
    const remaining = subs.json().subscriptions
    assert.equal(remaining.length, 1)
    assert.equal(remaining[0].source, 'Manual entry')

    await runtimeC.close()
  })

  await t.test('idempotency: processing the same provider message twice across a restart creates no duplicates', async () => {
    const runtimeD = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const { headers: headersD } = await authenticate(runtimeD.app, testUsers.idempotency)
    await runtimeD.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/authorize', headers: headersD })
    const firstScan = await runtimeD.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: headersD })
    assert.equal(firstScan.json().found, 7)
    await runtimeD.close()

    const runtimeE = await createRuntime(buildApp, settings, { provider: createTestProvider() })
    const { headers: headersE } = await authenticate(runtimeE.app, testUsers.idempotency)
    const secondScan = await runtimeE.app.inject({ method: 'POST', url: '/api/v1/sources/gmail/scan', headers: headersE })
    assert.equal(secondScan.statusCode, 200)
    assert.equal(secondScan.json().found, 0)

    const subs = await runtimeE.app.inject({ method: 'GET', url: '/api/v1/subscriptions', headers: headersE })
    assert.equal(subs.json().subscriptions.length, 6)
    assert.equal(subs.json().subscriptions[0].billingHistory.length, 1)
    assert.equal(subs.json().subscriptions[0].evidence.length, 1)
    await runtimeE.close()
  })

  await t.test('concurrency: two simultaneous scans for the same connection produce one accepted scan and one 409, with no duplicate processing', async () => {
    const slowProvider = createTestProvider({
      listCandidateMessages: async () => { await sleep(250); return [{ id: 'mock-message-netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of USD $22.99 renews Sep 12, 2026.' }] },
    })
    const runtimeF = await createRuntime(buildApp, settings, { provider: slowProvider })
    const { headers: headersF } = await authenticate(runtimeF.app, testUsers.concurrent)
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
