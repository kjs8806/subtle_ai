import assert from 'node:assert/strict'
import test from 'node:test'
import { Pool } from 'pg'
import { runMigrations } from '../server/persistence/migrations.js'
import { createPostgresRepository } from '../server/persistence/postgresRepository.js'
import { createTokenVault } from '../server/security/tokenVault.js'

const connectionString = process.env.DATABASE_URL
const integration = connectionString ? test : test.skip

const connectPool = async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const pool = new Pool({ connectionString })
    try { await pool.query('SELECT 1'); return pool } catch (error) {
      await pool.end()
      if (attempt === 19) throw error
    }
  }
}

const receipt = (sourceId, { rawMerchant = 'netflix-billing', amount = 15.49, currency = 'USD', receivedAt = '2026-06-12T09:00:00.000Z' } = {}) => ({
  sourceId,
  canonicalService: 'Netflix',
  rawMerchant,
  amount,
  currency,
  cadence: 'monthly',
  nextRenewal: null,
  receivedAt,
  confidence: { score: 0.9, state: 'confirmed' },
  fieldObservations: {
    canonicalService: { value: 'Netflix', provenance: 'confirmed' },
    amount: { value: amount, provenance: 'confirmed' },
    currency: { value: currency, provenance: 'confirmed' },
    cadence: { value: 'monthly', provenance: 'confirmed' },
  },
  excerpt: 'Netflix receipt',
})

integration('FEATURE-003: price-change events are durable, idempotent across repeated reads, dismissible, and account-isolated', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const userA = await repository.createUser({ email: 'a@example.com', name: 'A' })
    const userB = await repository.createUser({ email: 'b@example.com', name: 'B' })
    const token = createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token')
    await repository.authorizeConnection(userA.id, token)
    await repository.authorizeConnection(userB.id, token)

    // Two receipts for the same subscription (same canonicalService +
    // rawMerchant) at different prices - a material increase (15.49 -> 17.99
    // is both >=5% and >=$24/year).
    const first = await repository.persistParsedEvidence(userA.id, receipt('msg-1', { amount: 15.49, receivedAt: '2026-06-12T09:00:00.000Z' }))
    await repository.persistParsedEvidence(userA.id, receipt('msg-2', { amount: 17.99, receivedAt: '2026-08-12T09:00:00.000Z' }))
    const subscriptionId = first.subscription.id

    const itemsFirstRead = await repository.listAttentionItems(userA.id)
    const priceItem = itemsFirstRead.find((item) => item.type === 'price_change' && item.subscriptionId === subscriptionId)
    assert.ok(priceItem, 'the material price increase surfaces as an attention item')
    assert.equal(priceItem.priceChange.previousPrice, 15.49)
    assert.equal(priceItem.priceChange.currentPrice, 17.99)
    assert.equal(priceItem.priceChange.isAttentionWorthy, true)

    const eventRows = await pool.query('SELECT count(*) FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(eventRows.rows[0].count, '1')

    // Simulate a rescan re-detecting the identical transition (e.g. the user
    // revisits Worth your attention, or the same evidence is reprocessed) -
    // this must never create a duplicate event row.
    await repository.listAttentionItems(userA.id)
    await repository.listAttentionItems(userA.id)
    const eventRowsAfterRepeat = await pool.query('SELECT count(*) FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(eventRowsAfterRepeat.rows[0].count, '1', 'repeated reads/rescans must not duplicate the derived event')

    // Dismiss and confirm it's gone from the live list but the underlying
    // fact/event row is untouched (dismissal is presentation state, not
    // data deletion).
    await repository.dismissAttentionItem(userA.id, priceItem.id)
    const itemsAfterDismiss = await repository.listAttentionItems(userA.id)
    assert.ok(!itemsAfterDismiss.some((item) => item.id === priceItem.id), 'a dismissed item no longer appears')
    const eventRowsAfterDismiss = await pool.query('SELECT count(*) FROM price_change_events WHERE subscription_id = $1', [subscriptionId])
    assert.equal(eventRowsAfterDismiss.rows[0].count, '1', 'dismissing an item does not delete the underlying price-change fact')

    // Account isolation: user B has no subscriptions at all, so their
    // attention list must be empty regardless of what user A has.
    const userBItems = await repository.listAttentionItems(userB.id)
    assert.deepEqual(userBItems, [])
  } finally {
    await pool.end()
  }
})

integration('FEATURE-003: a confirmed price decrease is never attention-worthy, and a >30-day-out renewal never surfaces', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'c@example.com', name: 'C' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const first = await repository.persistParsedEvidence(user.id, receipt('msg-dec-1', { amount: 15.99, receivedAt: '2026-06-01T09:00:00.000Z' }))
    await repository.persistParsedEvidence(user.id, receipt('msg-dec-2', { amount: 12.99, receivedAt: '2026-08-01T09:00:00.000Z' }))
    // A renewal 60 days out - outside the 30-day window, must produce no card.
    await pool.query("UPDATE subscriptions SET next_renewal = (now() + interval '60 days')::date WHERE id = $1", [first.subscription.id])

    const items = await repository.listAttentionItems(user.id)
    assert.equal(items.filter((item) => item.type === 'price_change').length, 0, 'a decrease is never attention-worthy')
    assert.equal(items.filter((item) => item.type === 'renewal' && item.subscriptionId === first.subscription.id).length, 0, 'a renewal more than 30 days out produces no attention item')
  } finally {
    await pool.end()
  }
})
