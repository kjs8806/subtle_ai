// MVP-BETA-004 (#41): repository-level contract tests for Gmail disconnect
// purge and full account deletion. The same test bodies run against both
// createMemoryRepository() and createPostgresRepository() (when a test
// database is reachable) - both repositories must behave identically, and
// the memory backend especially needs this since it has no FK/cascade
// safety net at all to catch a table the application code forgot to clear
// (see server/persistence/memoryRepository.js's disconnectConnection/
// deleteAccount comments for the specific gaps this replaces).
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { Pool } from 'pg'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'
import { createPostgresRepository } from '../server/persistence/postgresRepository.js'
import { runMigrations } from '../server/persistence/migrations.js'

const receipt = (sourceId, amount, canonicalService = 'Netflix', rawMerchant = 'billing') => ({
  sourceId,
  canonicalService,
  rawMerchant,
  amount,
  currency: 'USD',
  cadence: 'monthly',
  nextRenewal: '2026-09-15',
  receivedAt: '2026-08-19T09:00:00.000Z',
  confidence: { score: 0.9, state: 'confirmed' },
  fieldObservations: {
    canonicalService: { value: canonicalService, provenance: 'confirmed' },
    amount: { value: amount, provenance: 'confirmed' },
    currency: { value: 'USD', provenance: 'confirmed' },
    cadence: { value: 'monthly', provenance: 'confirmed' },
  },
  excerpt: `${canonicalService} receipt`,
})

// Populates everything FEATURE-001/002/003 can attach to an account: two
// price observations on one subscription (-> a price_change_event), a
// correction, a confirmed candidate (the scenario that used to throw a
// foreign key violation against Postgres), a pending candidate, and a
// dismissed attention item.
const populateAccount = async (repository, userId) => {
  await repository.authorizeConnection(userId)
  const first = await repository.persistParsedEvidence(userId, receipt(`${userId}-msg-1`, 15))
  await repository.persistParsedEvidence(userId, receipt(`${userId}-msg-2`, 18))
  await repository.applyCorrection(userId, first.subscription.id, 'plan', 'Premium')
  await repository.persistCandidate(userId, { sourceId: `${userId}-cand-1`, canonicalService: 'Spotify', rawMerchant: 'billing', amount: 10, currency: 'USD', cadence: 'monthly', nextRenewal: null, receivedAt: '2026-08-19T09:00:00.000Z', excerpt: 'ambiguous' })
  const confirmable = await repository.listCandidates(userId)
  await repository.confirmCandidate(userId, confirmable[0].id)
  await repository.persistCandidate(userId, { sourceId: `${userId}-cand-2`, canonicalService: 'Dropbox', rawMerchant: 'billing', amount: 8, currency: 'USD', cadence: 'monthly', nextRenewal: null, receivedAt: '2026-08-19T09:00:00.000Z', excerpt: 'ambiguous 2' })
  const attentionItems = await repository.listAttentionItems(userId)
  if (attentionItems.length) await repository.dismissAttentionItem(userId, attentionItems[0].id)
}

const isEmptyAccount = async (repository, userId) => {
  const subscriptions = await repository.listSubscriptions(userId)
  const candidates = await repository.listCandidates(userId)
  const attentionItems = await repository.listAttentionItems(userId)
  return subscriptions.length === 0 && candidates.length === 0 && attentionItems.length === 0
}

const runContractTests = (label, createRepository, testFn = test) => {
  testFn(`[${label}] disconnectConnection purges every Gmail-derived record, including a confirmed candidate, without throwing`, async () => {
    const repository = await createRepository()
    const userA = await repository.createUser({ email: `${label}-a@example.com`, name: 'A' })
    const userB = await repository.createUser({ email: `${label}-b@example.com`, name: 'B' })
    await populateAccount(repository, userA.id)
    await populateAccount(repository, userB.id)

    assert.equal(await isEmptyAccount(repository, userA.id), false, 'test setup did not populate userA')

    // memoryRepository's disconnectConnection is synchronous (no Promise to
    // reject), so this wraps it rather than passing the call directly to
    // assert.doesNotReject, which requires an actual Promise/function.
    await assert.doesNotReject(async () => repository.disconnectConnection(userA.id), 'disconnect must not throw for a user with a confirmed candidate')

    assert.equal(await isEmptyAccount(repository, userA.id), true, 'userA must have zero subscriptions/candidates/attention items after disconnect')
    const connection = await repository.getConnection(userA.id)
    assert.equal(connection.status, 'not_connected')
    const stillUser = await repository.getUser(userA.id)
    assert.ok(stillUser, 'disconnect must preserve the user account itself')

    // userB is completely untouched.
    assert.equal(await isEmptyAccount(repository, userB.id), false, "userB's data must be untouched by userA's disconnect")
  })

  testFn(`[${label}] deleteAccount removes the user and every scoped record, and never affects another account`, async () => {
    const repository = await createRepository()
    const userC = await repository.createUser({ email: `${label}-c@example.com`, name: 'C' })
    const userD = await repository.createUser({ email: `${label}-d@example.com`, name: 'D' })
    await populateAccount(repository, userC.id)
    await populateAccount(repository, userD.id)

    const result = await repository.deleteAccount(userC.id)
    assert.equal(result.deleted, true)

    assert.equal(await repository.getUser(userC.id), null, 'the user record itself must be gone')
    assert.equal(await isEmptyAccount(repository, userC.id), true)

    // Deleting an already-deleted account is a safe, informative no-op.
    const secondDelete = await repository.deleteAccount(userC.id)
    assert.equal(secondDelete.deleted, false)

    // userD is completely untouched.
    assert.ok(await repository.getUser(userD.id), "userD's account must still exist")
    assert.equal(await isEmptyAccount(repository, userD.id), false, "userD's data must be untouched by userC's deletion")
  })

  testFn(`[${label}] re-authenticating with the same identity after deleteAccount creates a new account, never resurrecting the old one`, async () => {
    const repository = await createRepository()
    const first = await repository.resolveOrCreateIdentity({ provider: 'google', subject: `${label}-resurrect-subject`, email: 'resurrect@example.com', name: 'Resurrect' })
    await populateAccount(repository, first.id)
    await repository.deleteAccount(first.id)

    const second = await repository.resolveOrCreateIdentity({ provider: 'google', subject: `${label}-resurrect-subject`, email: 'resurrect@example.com', name: 'Resurrect' })
    assert.notEqual(second.id, first.id, 'expected a brand-new internal user id')
    assert.equal(await isEmptyAccount(repository, second.id), true, "the new account must not inherit the deleted account's data")
  })
}

runContractTests('memory', async () => createMemoryRepository())

// A dedicated, isolated database (not the literal DATABASE_URL database
// postgres.integration.test.js and subscriptionCorrections.test.js share) -
// node:test runs separate test files concurrently by default, and those
// files' own DROP SCHEMA public CASCADE resets race against this file's
// queries when they all target the same physical database. Matches
// priceChangeEventRemediation.postgres.test.js/runtimePersistence.
// integration.test.js's isolation pattern, adopted here after this file
// hit exactly the "relation ... does not exist" failure that pattern's own
// comment describes.
const baseConnectionString = process.env.DATABASE_URL
const DB_NAME = 'subtle_ai_test_account_lifecycle'
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

let pool
if (baseConnectionString) {
  before(async () => {
    const admin = await waitForPool(baseConnectionString)
    try {
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_NAME])
      if (!exists.rowCount) await admin.query(`CREATE DATABASE "${DB_NAME}"`)
    } finally {
      await admin.end()
    }
    pool = await waitForPool(withDatabaseName(baseConnectionString, DB_NAME))
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
  })
  after(async () => { if (pool) await pool.end() })
}
runContractTests('postgres', async () => createPostgresRepository({ pool }), baseConnectionString ? test : test.skip)
