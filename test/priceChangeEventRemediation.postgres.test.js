// Tech Lead remediation tests (GitHub PR #37).
//
// First-round review (of commit 40327261) - BLOCKER 1 and BLOCKER 2:
// BLOCKER 1: price_change_events' identity must be one canonical value,
// referenced identically by the persisted event row, the attention item id,
// and the dismissal key.
// BLOCKER 2: that identity must be derived from source observation
// provenance, not raw price values, so two genuinely separate transitions
// through the same two prices at different points in time are never
// collapsed into one row.
//
// Second-round review (of commit 8473ff9b) - BLOCKER 1 and BLOCKER 2:
// BLOCKER 1: "the current occurrence" per subscription must be selected by
// real-world observation chronology (current_price_observation_id's
// observed_at), never by detected_at - Postgres's transaction-stable now()
// means several historical events inserted in one recomputation transaction
// can share an identical detected_at.
// BLOCKER 2: a currency or billing_cycle correction is also an input to
// derived price intelligence and must invalidate/recompute stale numbers on
// every event it can still reach (self-heal via ON CONFLICT ... DO UPDATE),
// and an event whose currency/cadence no longer matches the live
// subscription (a currency correction can leave zero same-currency history
// to recompute against) must never be shown as current - without ever
// relabeling the original receipt evidence.

import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'
import { runMigrations } from '../server/persistence/migrations.js'
import { createPostgresRepository } from '../server/persistence/postgresRepository.js'
import { createTokenVault } from '../server/security/tokenVault.js'

const baseConnectionString = process.env.DATABASE_URL
const integration = baseConnectionString ? test : test.skip

// This file's own database, isolated from the default `postgres` database
// other integration test files reset via DROP SCHEMA public CASCADE - those
// files can run concurrently as separate node:test worker processes, and
// sharing the literal `postgres` database caused exactly that race (one
// file's schema reset wiping tables another file was mid-query against,
// surfacing as spurious "relation ... does not exist" failures only when
// the full suite ran multiple *.postgres.test.js files together). Matches
// runtimePersistence.integration.test.js's isolation pattern.
const DB_NAME = 'subtle_ai_test_price_change_remediation'
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

const connectPool = async () => {
  await ensureIsolatedDatabase(baseConnectionString, DB_NAME)
  return waitForPool(withDatabaseName(baseConnectionString, DB_NAME))
}

const receipt = (sourceId, { rawMerchant = 'canva-billing', amount, receivedAt, currency = 'USD' } = {}) => ({
  sourceId,
  canonicalService: 'Canva Pro',
  rawMerchant,
  amount,
  currency,
  cadence: 'monthly',
  nextRenewal: null,
  receivedAt,
  confidence: { score: 0.9, state: 'confirmed' },
  fieldObservations: {
    canonicalService: { value: 'Canva Pro', provenance: 'confirmed' },
    amount: { value: amount, provenance: 'confirmed' },
    currency: { value: currency, provenance: 'confirmed' },
    cadence: { value: 'monthly', provenance: 'confirmed' },
  },
  excerpt: 'Canva Pro receipt',
})

integration('BLOCKER 1: the persisted event, the attention item, and the dismissal all share the exact same identity, and it survives reprocessing', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'blocker1@example.com', name: 'Blocker One' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-1', { amount: 14.99, receivedAt: '2026-01-01T09:00:00.000Z' }))
    await repository.persistParsedEvidence(user.id, receipt('msg-2', { amount: 17.99, receivedAt: '2026-02-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id

    // The event is persisted at evidence-write time, not on the next GET -
    // no read has happened yet.
    const persisted = await pool.query('SELECT id, event_key, previous_price_observation_id, current_price_observation_id FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(persisted.rows.length, 1, 'the transition is persisted as soon as the second receipt is evidenced, not deferred to a read')
    const eventRow = persisted.rows[0]
    assert.ok(eventRow.event_key, 'the row carries its own canonical event_key')
    assert.ok(eventRow.previous_price_observation_id, 'previous side traces to a real price_observations row')
    assert.ok(eventRow.current_price_observation_id, 'current side traces to a real price_observations row')

    const items = await repository.listAttentionItems(user.id)
    const priceItem = items.find((item) => item.type === 'price_change' && item.subscriptionId === subscriptionId)
    assert.ok(priceItem)

    // BLOCKER 1's exact requirement: the attention item's id is built from
    // the *same* event_key the table persisted - one canonical identity,
    // not two independently-derived ones.
    assert.equal(priceItem.id, `price-change:${eventRow.event_key}`)
    assert.equal(priceItem.priceChange.eventKey, eventRow.event_key)

    await repository.dismissAttentionItem(user.id, priceItem.id)
    const dismissalRow = await pool.query('SELECT item_key FROM attention_item_dismissals WHERE user_id = $1', [user.id])
    assert.equal(dismissalRow.rows[0].item_key, priceItem.id, 'the dismissal stores the exact same identity as the attention item id')

    // "Recomputation/rescan does not generate a new identity for the same
    // occurrence": persisting a third receipt at a *different* price
    // re-triggers full-history recomputation (recordPriceChangeEvents runs
    // on every persistParsedEvidence call) - the January->February event's
    // row, id, and event_key must all stay exactly as they were.
    await repository.persistParsedEvidence(user.id, receipt('msg-3', { amount: 20.99, receivedAt: '2026-03-01T09:00:00.000Z' }))
    const afterRescan = await pool.query('SELECT id, event_key FROM price_change_events WHERE subscription_id = $1 AND id = $2', [subscriptionId, eventRow.id])
    assert.equal(afterRescan.rows.length, 1, 'the original event row still exists, unchanged')
    assert.equal(afterRescan.rows[0].event_key, eventRow.event_key, 'its identity did not change or duplicate on reprocessing')

    // The dismissal (keyed to the January->February occurrence specifically)
    // must still suppress exactly that item and nothing else - the new
    // February->March transition is a *different* occurrence and appears.
    const itemsAfterRescan = await repository.listAttentionItems(user.id)
    assert.ok(!itemsAfterRescan.some((item) => item.id === priceItem.id), 'the dismissed occurrence stays dismissed after reprocessing')
    assert.ok(itemsAfterRescan.some((item) => item.type === 'price_change' && item.priceChange.previousPrice === 17.99 && item.priceChange.currentPrice === 20.99), 'the new, distinct transition is its own item')
  } finally {
    await pool.end()
  }
})

integration('BLOCKER 1: dismissal survives a full repository restart (fresh pool against the same database)', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repositoryBeforeRestart = createPostgresRepository({ pool })
    const user = await repositoryBeforeRestart.createUser({ email: 'restart@example.com', name: 'Restart' })
    await repositoryBeforeRestart.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))
    await repositoryBeforeRestart.persistParsedEvidence(user.id, receipt('msg-1', { amount: 14.99, receivedAt: '2026-01-01T09:00:00.000Z' }))
    await repositoryBeforeRestart.persistParsedEvidence(user.id, receipt('msg-2', { amount: 17.99, receivedAt: '2026-02-01T09:00:00.000Z' }))
    const itemsBefore = await repositoryBeforeRestart.listAttentionItems(user.id)
    const priceItem = itemsBefore.find((item) => item.type === 'price_change')
    await repositoryBeforeRestart.dismissAttentionItem(user.id, priceItem.id)

    // A fresh repository instance against the same underlying database - the
    // closest this test suite can get to "the process restarted" without a
    // second Node process (see runtimePersistence.integration.test.js for
    // that fuller restart simulation via createRuntime).
    const repositoryAfterRestart = createPostgresRepository({ pool })
    const itemsAfter = await repositoryAfterRestart.listAttentionItems(user.id)
    assert.ok(!itemsAfter.some((item) => item.id === priceItem.id), 'the dismissal persisted in the database, not in repository memory')
  } finally {
    await pool.end()
  }
})

integration('BLOCKER 2: three transitions through the same two prices at different times each get their own durable, correctly-provenanced event, and reprocessing never duplicates them', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'blocker2@example.com', name: 'Blocker Two' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    // Jan: 10 -> 12 (event A). Jun: 12 -> 10 (event B). Dec: 10 -> 12 again
    // (event C) - the same price pair as event A, at a different time.
    const first = await repository.persistParsedEvidence(user.id, receipt('msg-jan-10', { amount: 10, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    await repository.persistParsedEvidence(user.id, receipt('msg-jan-12', { amount: 12, receivedAt: '2026-01-15T09:00:00.000Z' }))
    await repository.persistParsedEvidence(user.id, receipt('msg-jun-10', { amount: 10, receivedAt: '2026-06-01T09:00:00.000Z' }))
    await repository.persistParsedEvidence(user.id, receipt('msg-dec-12', { amount: 12, receivedAt: '2026-12-01T09:00:00.000Z' }))

    const events = await pool.query(
      'SELECT event_key, previous_price, current_price, previous_price_observation_id, current_price_observation_id, detected_at FROM price_change_events WHERE subscription_id = $1 ORDER BY detected_at',
      [subscriptionId],
    )
    assert.equal(events.rows.length, 3, 'each of the three transitions is its own persisted event')
    const [eventA, eventB, eventC] = events.rows

    assert.equal(Number(eventA.previous_price), 10); assert.equal(Number(eventA.current_price), 12)
    assert.equal(Number(eventB.previous_price), 12); assert.equal(Number(eventB.current_price), 10)
    assert.equal(Number(eventC.previous_price), 10); assert.equal(Number(eventC.current_price), 12)

    // The crux of BLOCKER 2: event A and event C are the same price
    // transition (10 -> 12) but must never collide - distinct event_key,
    // distinct row, distinct observation-pair provenance.
    assert.notEqual(eventA.event_key, eventC.event_key, 'January\'s 10->12 and December\'s 10->12 must not collide on identity')
    assert.notEqual(eventA.previous_price_observation_id, eventC.previous_price_observation_id, 'they trace to different source observations')
    assert.notEqual(eventA.current_price_observation_id, eventC.current_price_observation_id)

    // Reprocessing (a rescan) must not create a 4th event for the already-
    // persisted transitions. recordPriceChangeEvents runs on every
    // persistParsedEvidence call and recomputes the *entire* history - the
    // idempotency guarantee (ON CONFLICT (event_key) DO NOTHING) is what's
    // under test: persisting one more receipt *at the same current price*
    // (no new transition) must leave the count at exactly 3.
    await repository.persistParsedEvidence(user.id, receipt('msg-dec-12-again', { amount: 12, receivedAt: '2026-12-15T09:00:00.000Z' }))
    const eventsAfterRescan = await pool.query('SELECT count(*) FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(eventsAfterRescan.rows[0].count, '3', 'no phantom 4th event from reprocessing an unchanged current price')
  } finally {
    await pool.end()
  }
})

integration('a FEATURE-002 correction to current_price is detected and persisted through the same observation-pair identity model', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'correction@example.com', name: 'Correction' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-1', { amount: 14.99, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id

    await repository.applyCorrection(user.id, subscriptionId, 'current_price', 20)
    const events = await pool.query('SELECT event_key, previous_price, current_price, current_price_observation_id FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(events.rows.length, 1, 'the correction is detected as a price change, not silently ignored')
    assert.equal(Number(events.rows[0].previous_price), 14.99)
    assert.equal(Number(events.rows[0].current_price), 20)
    assert.ok(events.rows[0].current_price_observation_id, 'the correction is traceable through a real price_observations row (evidence_id NULL), not a second identity scheme')

    const items = await repository.listAttentionItems(user.id)
    const priceItem = items.find((item) => item.type === 'price_change')
    assert.ok(priceItem, 'the corrected price change is attention-worthy and surfaces')
    assert.equal(priceItem.id, `price-change:${events.rows[0].event_key}`)
  } finally {
    await pool.end()
  }
})

// ============================================================
// Second-round remediation (review of commit 8473ff9b)
// ============================================================

integration('SECOND ROUND BLOCKER 1: several historical events inserted within one recomputation transaction (identical detected_at) still resolve to the chronologically latest by observation time', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'chronology@example.com', name: 'Chronology' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-jan-10', { amount: 10, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    // Seed the rest of the history directly (bypassing persistParsedEvidence,
    // which would otherwise trigger recordPriceChangeEvents once per
    // receipt) so none of these three transitions has been detected/
    // persisted yet - the *next* recompute must discover and insert all
    // three in a single call/transaction.
    await pool.query(
      `INSERT INTO price_observations (subscription_id, evidence_id, amount, currency, observed_at) VALUES
         ($1, NULL, 12, 'USD', '2026-01-15T09:00:00.000Z'),
         ($1, NULL, 10, 'USD', '2026-06-01T09:00:00.000Z'),
         ($1, NULL, 12, 'USD', '2026-12-01T09:00:00.000Z')`,
      [subscriptionId],
    )

    // A single correction (to the value it already has) is enough to run
    // recordPriceChangeEvents exactly once, over the full four-observation
    // history, inside one transaction.
    await repository.applyCorrection(user.id, subscriptionId, 'billing_cycle', 'monthly')

    const events = await pool.query('SELECT event_key, previous_price, current_price, detected_at FROM price_change_events WHERE subscription_id = $1 ORDER BY current_price_observation_id', [subscriptionId])
    assert.equal(events.rows.length, 3, 'all three historical transitions were discovered and persisted in the one recompute pass')
    const detectedTimestamps = new Set(events.rows.map((row) => row.detected_at.getTime()))
    assert.equal(detectedTimestamps.size, 1, "Postgres's transaction-stable now() gives all three rows the exact same detected_at - the premise this test is built to force")

    // Despite identical detected_at, GET /api/v1/attention must still
    // surface the chronologically latest transition (December's 10 -> 12),
    // not an arbitrary one of the three.
    const items = await repository.listAttentionItems(user.id)
    const priceItem = items.find((item) => item.type === 'price_change' && item.subscriptionId === subscriptionId)
    assert.ok(priceItem)
    assert.equal(priceItem.priceChange.previousPrice, 10)
    assert.equal(priceItem.priceChange.currentPrice, 12)
    assert.equal(priceItem.priceChange.firstSeenAt.toISOString?.() ?? priceItem.priceChange.firstSeenAt, '2026-12-01T09:00:00.000Z', 'the December event specifically, identified by its observation date, not detected_at')
  } finally {
    await pool.end()
  }
})

integration('SECOND ROUND BLOCKER 2: correcting billing_cycle from monthly to yearly recomputes annual impact/materiality on the existing event, not just current_price corrections', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'cadence-my@example.com', name: 'Cadence' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    // $10 -> $12/month: 20% increase, $24/year impact - attention-worthy on
    // both legs of the threshold.
    const first = await repository.persistParsedEvidence(user.id, receipt('msg-1', { amount: 10, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    await repository.persistParsedEvidence(user.id, receipt('msg-2', { amount: 12, receivedAt: '2026-02-01T09:00:00.000Z' }))
    const before = await pool.query('SELECT id, event_key, cadence, annual_impact, is_attention_worthy FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(before.rows[0].cadence, 'monthly')
    assert.equal(Number(before.rows[0].annual_impact), 24)
    assert.equal(before.rows[0].is_attention_worthy, true)

    await repository.applyCorrection(user.id, subscriptionId, 'billing_cycle', 'yearly')

    // Same event (same event_key/row - the underlying observations did not
    // change), but its cadence-dependent numbers are now correct for yearly
    // billing: a $10 -> $12 *yearly* transition is only $2/year impact. It
    // remains attention-worthy only because the percentage leg (20%) still
    // independently qualifies.
    const after = await pool.query('SELECT id, event_key, cadence, annual_impact, percent_change, is_attention_worthy FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(after.rows.length, 1, 'no new event row was created - the existing one was updated in place')
    assert.equal(after.rows[0].id, before.rows[0].id, 'same row')
    assert.equal(after.rows[0].event_key, before.rows[0].event_key, 'same canonical identity - only the derived numbers changed')
    assert.equal(after.rows[0].cadence, 'yearly')
    assert.equal(Number(after.rows[0].annual_impact), 2, 'a $10->$12 *yearly* transition is $2/year, not the stale $24 computed under monthly')
    assert.equal(Number(after.rows[0].percent_change), 20, 'percent change is cadence-independent and unchanged')
    assert.equal(after.rows[0].is_attention_worthy, true, 'still attention-worthy via the 20% threshold even though the $24 annual-impact leg no longer qualifies')

    const items = await repository.listAttentionItems(user.id)
    const priceItem = items.find((item) => item.type === 'price_change')
    assert.equal(priceItem.priceChange.annualImpact, 2, 'the live attention item reflects the corrected cadence, never the stale pre-correction number')
    assert.equal(priceItem.id, `price-change:${before.rows[0].event_key}`, 'the attention item id is unchanged - the correction updated the occurrence, it did not create a new one')
  } finally {
    await pool.end()
  }
})

integration('SECOND ROUND BLOCKER 2: correcting billing_cycle from yearly to monthly recomputes the symmetric direction', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'cadence-yr@example.com', name: 'Cadence Yearly' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const yearlyReceipt = (sourceId, opts) => ({ ...receipt(sourceId, opts), cadence: 'yearly', fieldObservations: { ...receipt(sourceId, opts).fieldObservations, cadence: { value: 'yearly', provenance: 'confirmed' } } })
    // $100 -> $110/year: 10% increase, $10/year impact - attention-worthy on
    // the percentage leg alone (under $24/year).
    const first = await repository.persistParsedEvidence(user.id, yearlyReceipt('msg-1', { amount: 100, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    await repository.persistParsedEvidence(user.id, yearlyReceipt('msg-2', { amount: 110, receivedAt: '2026-02-01T09:00:00.000Z' }))
    const before = await pool.query('SELECT cadence, annual_impact, is_attention_worthy FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(before.rows[0].cadence, 'yearly')
    assert.equal(Number(before.rows[0].annual_impact), 10)

    await repository.applyCorrection(user.id, subscriptionId, 'billing_cycle', 'monthly')

    // The same $100->$110 transition, reinterpreted as monthly billing, is a
    // $120/year impact - well past the $24 threshold.
    const after = await pool.query('SELECT cadence, annual_impact, is_attention_worthy FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(after.rows[0].cadence, 'monthly')
    assert.equal(Number(after.rows[0].annual_impact), 120)
    assert.equal(after.rows[0].is_attention_worthy, true)
  } finally {
    await pool.end()
  }
})

integration('SECOND ROUND BLOCKER 2: correcting currency from USD to CAD suppresses the now-foreign-currency event as "current" without deleting it, and never relabels the original receipt evidence', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'currency@example.com', name: 'Currency' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-1', { amount: 10, currency: 'USD', receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    await repository.persistParsedEvidence(user.id, receipt('msg-2', { amount: 12, currency: 'USD', receivedAt: '2026-02-01T09:00:00.000Z' }))

    const itemsBefore = await repository.listAttentionItems(user.id)
    assert.ok(itemsBefore.some((item) => item.type === 'price_change' && item.subscriptionId === subscriptionId), 'the USD price increase is the current item before any correction')

    await repository.applyCorrection(user.id, subscriptionId, 'currency', 'CAD')

    // The event row is NOT deleted - useful historical provenance is
    // preserved - but it must never be shown as the live subscription's
    // current occurrence once the subscription's own currency has moved on
    // and there is no CAD history to legitimately compare against.
    const eventRows = await pool.query('SELECT currency, previous_price, current_price FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(eventRows.rows.length, 1, 'the historical USD event record is preserved, not deleted')
    assert.equal(eventRows.rows[0].currency, 'USD', "the event's own currency is left exactly as it was computed - it is not relabeled to CAD")

    const itemsAfter = await repository.listAttentionItems(user.id)
    assert.ok(!itemsAfter.some((item) => item.type === 'price_change' && item.subscriptionId === subscriptionId), 'the stale USD event must never be shown as current once the subscription is CAD - no fabricated cross-currency comparison')

    // The original receipts are never rewritten to say CAD.
    const observations = await pool.query('SELECT currency FROM price_observations WHERE subscription_id = $1 AND evidence_id IS NOT NULL', [subscriptionId])
    assert.ok(observations.rows.every((row) => row.currency === 'USD'), 'original receipt-derived price observations keep their real, originally-observed currency')
  } finally {
    await pool.end()
  }
})

integration('SECOND ROUND: corrected cadence/currency-derived state survives a repository restart', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repositoryBeforeRestart = createPostgresRepository({ pool })
    const user = await repositoryBeforeRestart.createUser({ email: 'restart-correction@example.com', name: 'Restart Correction' })
    await repositoryBeforeRestart.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))
    const first = await repositoryBeforeRestart.persistParsedEvidence(user.id, receipt('msg-1', { amount: 10, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    await repositoryBeforeRestart.persistParsedEvidence(user.id, receipt('msg-2', { amount: 12, receivedAt: '2026-02-01T09:00:00.000Z' }))
    await repositoryBeforeRestart.applyCorrection(user.id, subscriptionId, 'billing_cycle', 'yearly')

    const repositoryAfterRestart = createPostgresRepository({ pool })
    const items = await repositoryAfterRestart.listAttentionItems(user.id)
    const priceItem = items.find((item) => item.type === 'price_change')
    assert.ok(priceItem, 'the corrected occurrence is still there after a fresh repository instance')
    assert.equal(priceItem.priceChange.annualImpact, 2, 'the recomputed (not stale) annual impact persisted across the restart')
  } finally {
    await pool.end()
  }
})

integration('SECOND ROUND: dismissing one occurrence never suppresses a genuinely different one, and a correction-driven self-heal keeps the same identity so its dismissal still applies', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'dismiss-identity@example.com', name: 'Dismiss Identity' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-jan-10', { amount: 10, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    await repository.persistParsedEvidence(user.id, receipt('msg-jan-12', { amount: 12, receivedAt: '2026-01-15T09:00:00.000Z' }))
    const itemsBeforeDismiss = await repository.listAttentionItems(user.id)
    const januaryItem = itemsBeforeDismiss.find((item) => item.type === 'price_change')
    await repository.dismissAttentionItem(user.id, januaryItem.id)

    // A cadence correction self-heals January's event in place (same
    // event_key) - the dismissal, keyed to that exact identity, must still
    // suppress it.
    await repository.applyCorrection(user.id, subscriptionId, 'billing_cycle', 'yearly')
    const itemsAfterSelfHeal = await repository.listAttentionItems(user.id)
    assert.ok(!itemsAfterSelfHeal.some((item) => item.id === januaryItem.id), 'the dismissal survives a same-identity self-heal recomputation')

    // A later, genuinely different transition (a new event_key) must not be
    // suppressed just because an earlier, unrelated occurrence was dismissed.
    await repository.persistParsedEvidence(user.id, receipt('msg-jun-10', { amount: 10, receivedAt: '2026-06-01T09:00:00.000Z' }))
    await repository.persistParsedEvidence(user.id, receipt('msg-dec-12', { amount: 12, receivedAt: '2026-12-01T09:00:00.000Z' }))
    const itemsAfterNewTransition = await repository.listAttentionItems(user.id)
    const decemberItem = itemsAfterNewTransition.find((item) => item.type === 'price_change')
    assert.ok(decemberItem, 'the new, distinct December transition is its own occurrence, not suppressed by January\'s dismissal')
    assert.notEqual(decemberItem.id, januaryItem.id)
  } finally {
    await pool.end()
  }
})

integration('SECOND ROUND (found during this remediation, same class as BLOCKER 2): accepting a FEATURE-002 conflict also invalidates/recomputes price intelligence, not only a direct correction', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'accept-conflict@example.com', name: 'Accept Conflict' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-1', { amount: 10, receivedAt: '2026-01-01T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id
    // An active correction to yearly billing, in place before the second
    // receipt arrives.
    await repository.applyCorrection(user.id, subscriptionId, 'billing_cycle', 'yearly')

    // The second receipt's own cadence field observation ("monthly") conflicts
    // with the active yearly correction - correction precedence keeps
    // billing_cycle at "yearly" for now, and the conflict is surfaced rather
    // than silently applied.
    const second = await repository.persistParsedEvidence(user.id, receipt('msg-2', { amount: 12, receivedAt: '2026-02-01T09:00:00.000Z' }))
    const conflict = second.subscription.conflicts.find((c) => c.field === 'billing_cycle')
    assert.ok(conflict, 'the receipt\'s own "monthly" cadence conflicts with the active yearly correction')

    const beforeAccept = await repository.listAttentionItems(user.id)
    const beforeItem = beforeAccept.find((item) => item.type === 'price_change')
    assert.equal(beforeItem.priceChange.annualImpact, 2, 'still under the yearly correction: $10->$12/year is $2/year')

    // Accepting the conflict makes "monthly" (the receipt's own value) the
    // new authoritative correction - this must invalidate/recompute the
    // existing event exactly like a direct applyCorrection would.
    await repository.acceptConflict(user.id, conflict.id)
    const afterAccept = await repository.listAttentionItems(user.id)
    const afterItem = afterAccept.find((item) => item.type === 'price_change')
    assert.ok(afterItem, 'the event is still current after accepting the conflict')
    assert.equal(afterItem.priceChange.annualImpact, 24, 'now recomputed under monthly billing: $10->$12/month is $24/year, not the stale $2 from before accepting')
  } finally {
    await pool.end()
  }
})
