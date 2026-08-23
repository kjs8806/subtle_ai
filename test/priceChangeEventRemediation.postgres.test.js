// Tech Lead remediation tests (GitHub PR #37, review of commit
// 403272610bc1ef4d6a43d39ad1541347cd6b604d) - BLOCKER 1 and BLOCKER 2.
//
// BLOCKER 1: price_change_events' identity must be one canonical value,
// referenced identically by the persisted event row, the attention item id,
// and the dismissal key.
//
// BLOCKER 2: that identity must be derived from source observation
// provenance, not raw price values, so two genuinely separate transitions
// through the same two prices at different points in time are never
// collapsed into one row.
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
