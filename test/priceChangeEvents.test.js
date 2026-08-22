// FEATURE-003 repository-level contract tests for price_change_events:
// idempotency, correction precedence (annualization reads the corrected
// billing_cycle, not stale evidence cadence), account isolation, and
// exclusion of rejected subscriptions. The same test bodies run against both
// createMemoryRepository() and, when a PostgreSQL test database is reachable,
// createPostgresRepository() - exact pattern from test/subscriptionCorrections.test.js.
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { Pool } from 'pg'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'
import { createPostgresRepository } from '../server/persistence/postgresRepository.js'
import { runMigrations } from '../server/persistence/migrations.js'

const receipt = (sourceId, overrides = {}) => ({
  sourceId,
  canonicalService: 'Netflix',
  rawMerchant: 'billing',
  amount: 10,
  currency: 'USD',
  cadence: 'monthly',
  nextRenewal: null,
  receivedAt: '2026-08-19T09:00:00.000Z',
  confidence: { score: 0.9, state: 'confirmed' },
  excerpt: 'Netflix receipt',
  ...overrides,
  fieldObservations: {
    canonicalService: { value: 'Netflix', provenance: 'confirmed' },
    amount: { value: overrides.amount ?? 10, provenance: 'confirmed' },
    currency: { value: overrides.currency ?? 'USD', provenance: 'confirmed' },
    cadence: { value: overrides.cadence ?? 'monthly', provenance: 'confirmed' },
    ...overrides.fieldObservations,
  },
})

const runContractTests = (label, createRepository, testFn = test) => {
  testFn(`[${label}] a material price increase is recorded once and reprocessing the same evidence never duplicates it`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-pc-a@example.com`, name: 'A' })
    await repository.authorizeConnection(user.id)

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-1', { amount: 10 }))
    assert.equal((await repository.listMaterialPriceChangeEvents(user.id)).length, 0, 'a first-ever observation has nothing to compare against')

    // 10 -> 20 is a 100% increase: clearly material.
    await repository.persistParsedEvidence(user.id, receipt('msg-2', { amount: 20 }))
    const afterIncrease = await repository.listMaterialPriceChangeEvents(user.id)
    assert.equal(afterIncrease.length, 1)
    assert.equal(afterIncrease[0].subscriptionId, first.subscription.id)
    assert.equal(afterIncrease[0].direction, 'increase')
    assert.equal(afterIncrease[0].previousPriceCents, 1000)
    assert.equal(afterIncrease[0].currentPriceCents, 2000)
    assert.equal(afterIncrease[0].isMaterial, true)
    assert.equal(afterIncrease[0].canonicalService, 'Netflix')

    // Reprocessing the identical message (as a rescan would) must not create a duplicate event.
    const duplicate = await repository.persistParsedEvidence(user.id, receipt('msg-2', { amount: 20 }))
    assert.equal(duplicate.created, false)
    const stillOne = await repository.listMaterialPriceChangeEvents(user.id)
    assert.equal(stillOne.length, 1, 'reprocessing the same evidence does not duplicate the price-change event')
  })

  testFn(`[${label}] a price decrease and a non-material increase are never surfaced as attention items`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-pc-b@example.com`, name: 'B' })
    await repository.authorizeConnection(user.id)
    await repository.persistParsedEvidence(user.id, receipt('dec-msg-1', { amount: 20 }))
    await repository.persistParsedEvidence(user.id, receipt('dec-msg-2', { amount: 15 })) // a real decrease
    await repository.persistParsedEvidence(user.id, receipt('dec-msg-3', { amount: 15.10 })) // a trivial, non-material increase
    assert.deepEqual(await repository.listMaterialPriceChangeEvents(user.id), [], 'neither a decrease nor a non-material increase is an attention item')
  })

  testFn(`[${label}] annualized impact uses the corrected billing_cycle, not stale evidence cadence (correction precedence)`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-pc-c@example.com`, name: 'C' })
    await repository.authorizeConnection(user.id)
    const first = await repository.persistParsedEvidence(user.id, receipt('cad-msg-1', { amount: 90, cadence: 'monthly' }))
    const subscriptionId = first.subscription.id
    assert.equal(first.subscription.billingCycle, 'monthly')

    // FEATURE-002: the user corrects billing_cycle to yearly - new evidence's
    // own cadence must not silently overwrite it, and price-change detection
    // must read the corrected value, not the stale 'monthly' from evidence.
    await repository.applyCorrection(user.id, subscriptionId, 'billing_cycle', 'yearly')

    // 90 -> 100 is an 11.1% increase (material via percent regardless of
    // cadence); the annualized figure is what proves which cadence was used:
    // yearly cadence => annualizedDeltaCents = 1000 (the $10 delta itself).
    // A stale 'monthly' cadence would instead have produced 12000.
    await repository.persistParsedEvidence(user.id, receipt('cad-msg-2', { amount: 100, cadence: 'monthly' }))
    const events = await repository.listMaterialPriceChangeEvents(user.id)
    assert.equal(events.length, 1)
    assert.equal(events[0].annualizedDeltaCents, 1000, 'annualization used the corrected yearly cadence, not the stale monthly evidence cadence')
    assert.equal(events[0].billingCycle, 'yearly')
  })

  testFn(`[${label}] account isolation: price-change events are never visible to or computable from another user's repository calls`, async () => {
    const repository = await createRepository()
    const userA = await repository.createUser({ email: `${label}-pc-iso-a@example.com`, name: 'Iso A' })
    const userB = await repository.createUser({ email: `${label}-pc-iso-b@example.com`, name: 'Iso B' })
    await repository.authorizeConnection(userA.id)
    await repository.authorizeConnection(userB.id)

    await repository.persistParsedEvidence(userA.id, receipt('iso-msg-1', { amount: 10 }))
    await repository.persistParsedEvidence(userA.id, receipt('iso-msg-2', { amount: 20 }))
    await repository.persistParsedEvidence(userB.id, receipt('iso-msg-3', { amount: 10 }))
    await repository.persistParsedEvidence(userB.id, receipt('iso-msg-4', { amount: 30 }))

    const eventsA = await repository.listMaterialPriceChangeEvents(userA.id)
    const eventsB = await repository.listMaterialPriceChangeEvents(userB.id)
    assert.equal(eventsA.length, 1)
    assert.equal(eventsB.length, 1)
    assert.notEqual(eventsA[0].subscriptionId, eventsB[0].subscriptionId)
    assert.equal(eventsA[0].currentPriceCents, 2000)
    assert.equal(eventsB[0].currentPriceCents, 3000)
  })

  testFn(`[${label}] a rejected subscription's price-change events are excluded from the attention listing`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-pc-rej@example.com`, name: 'Rej' })
    await repository.authorizeConnection(user.id)
    const first = await repository.persistParsedEvidence(user.id, receipt('rej-msg-1', { amount: 10 }))
    await repository.persistParsedEvidence(user.id, receipt('rej-msg-2', { amount: 20 }))
    assert.equal((await repository.listMaterialPriceChangeEvents(user.id)).length, 1, 'material before rejection')

    await repository.rejectSubscription(user.id, first.subscription.id)
    assert.deepEqual(await repository.listMaterialPriceChangeEvents(user.id), [], 'excluded once the subscription is rejected')
  })
}

runContractTests('memory', async () => createMemoryRepository())

const connectionString = process.env.DATABASE_URL
let pool
if (connectionString) {
  before(async () => {
    pool = new Pool({ connectionString })
    await pool.query('SELECT 1')
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
  })
  after(async () => { if (pool) await pool.end() })
}
runContractTests('postgres', async () => createPostgresRepository({ pool }), connectionString ? test : test.skip)
