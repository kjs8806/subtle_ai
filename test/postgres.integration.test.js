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

const receipt = (sourceId, rawMerchant = 'billing', amount = 10, currency = 'USD') => ({
  sourceId,
  canonicalService: 'Netflix',
  rawMerchant,
  amount,
  currency,
  cadence: null,
  nextRenewal: null,
  receivedAt: '2026-08-19T09:00:00.000Z',
  confidence: { score: 0.74, state: 'inferred' },
  fieldObservations: {
    canonicalService: { value: 'Netflix', provenance: 'confirmed' },
    amount: { value: amount, provenance: 'confirmed' },
    currency: { value: currency, provenance: currency ? 'confirmed' : 'inferred' },
    cadence: { value: null, provenance: 'inferred' },
  },
  excerpt: 'Netflix receipt',
})

integration('PostgreSQL migrations, ownership, idempotency, provenance, and purge work against a real database', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const userA = await repository.createUser({ email: 'a@example.com', name: 'A' })
    const userB = await repository.createUser({ email: 'b@example.com', name: 'B' })
    await repository.authorizeConnection(userA.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))
    const stored = await pool.query('SELECT encrypted_refresh_token, token_key_version FROM source_connections WHERE user_id = $1', [userA.id])
    assert.notEqual(stored.rows[0].encrypted_refresh_token, 'refresh-token')
    assert.equal(stored.rows[0].token_key_version, 'v1')
    const first = await repository.persistParsedEvidence(userA.id, receipt('message-1'))
    const duplicate = await repository.persistParsedEvidence(userA.id, receipt('message-1'))
    assert.equal(first.created, true)
    assert.equal(duplicate.created, false)
    assert.equal(first.subscription.currency, 'USD')
    assert.equal(first.evidence.currency, 'USD')
    assert.equal((await pool.query('SELECT count(*) FROM billing_events')).rows[0].count, '1')
    const detail = await pool.query('SELECT provenance FROM field_observations WHERE subscription_id = $1 AND field = $2', [first.subscription.id, 'cadence'])
    assert.equal(detail.rows[0].provenance, 'inferred')
    const second = await repository.persistParsedEvidence(userA.id, receipt('message-2', 'partner-billing', 12))
    assert.notEqual(second.subscription.id, first.subscription.id)
    await pool.query('INSERT INTO subscriptions (user_id, canonical_service, raw_merchant, source) VALUES ($1, $2, $3, $4)', [userA.id, 'Netflix', 'billing', 'Gmail receipt'])
    const ambiguous = await repository.persistParsedEvidence(userA.id, receipt('message-ambiguous', 'billing', 11))
    assert.equal(ambiguous.ambiguous, true)
    assert.equal((await pool.query('SELECT count(*) FROM source_messages WHERE provider_message_id = $1', ['message-ambiguous'])).rows[0].count, '0')
    await assert.rejects(repository.persistParsedEvidence(userA.id, { ...receipt('message-rollback', 'rollback-billing'), fieldObservations: { cadence: { value: null, provenance: 'invalid' } } }))
    assert.equal((await pool.query('SELECT count(*) FROM source_messages WHERE provider_message_id = $1', ['message-rollback'])).rows[0].count, '0')
    await pool.query('INSERT INTO subscriptions (user_id, canonical_service, raw_merchant, source) VALUES ($1, $2, $3, $4)', [userA.id, 'Manual', 'manual', 'Manual entry'])
    assert.equal((await repository.getSubscription(userB.id, first.subscription.id)), null)
    await repository.disconnectConnection(userA.id)
    assert.equal((await pool.query('SELECT count(*) FROM source_connections WHERE user_id = $1', [userA.id])).rows[0].count, '0')
    assert.equal((await pool.query('SELECT count(*) FROM source_messages')).rows[0].count, '0')
    assert.equal((await pool.query('SELECT count(*) FROM evidence')).rows[0].count, '0')
    assert.equal((await pool.query('SELECT count(*) FROM subscriptions WHERE user_id = $1 AND source = $2', [userA.id, 'Gmail receipt'])).rows[0].count, '0')
    assert.equal((await pool.query('SELECT count(*) FROM subscriptions WHERE user_id = $1 AND source = $2', [userA.id, 'Manual entry'])).rows[0].count, '1')
  } finally {
    await pool.end()
  }
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

integration('resolveOrCreateIdentity maps a Google subject to an internal UUID user and de-duplicates concurrent first login', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })

    // Real Google `sub` claims are opaque numeric strings, not UUIDs.
    const subject = '104857612345678901234'
    const first = await repository.resolveOrCreateIdentity({ provider: 'google', subject, email: 'person@example.com', name: 'Person' })
    assert.match(first.id, UUID_RE)
    const stored = await pool.query('SELECT provider_subject FROM auth_identities WHERE user_id = $1 AND provider = $2', [first.id, 'google'])
    assert.equal(stored.rows[0].provider_subject, subject)

    const second = await repository.resolveOrCreateIdentity({ provider: 'google', subject, email: 'person@example.com', name: 'Person' })
    assert.equal(second.id, first.id)
    assert.equal((await pool.query('SELECT count(*) FROM users')).rows[0].count, '1')

    const otherSubject = '211348800987654321000'
    const other = await repository.resolveOrCreateIdentity({ provider: 'google', subject: otherSubject, email: 'other@example.com', name: 'Other' })
    assert.notEqual(other.id, first.id)

    const concurrentSubject = '337722991100223344556'
    const [race1, race2, race3] = await Promise.all([
      repository.resolveOrCreateIdentity({ provider: 'google', subject: concurrentSubject, email: 'race@example.com', name: 'Race' }),
      repository.resolveOrCreateIdentity({ provider: 'google', subject: concurrentSubject, email: 'race@example.com', name: 'Race' }),
      repository.resolveOrCreateIdentity({ provider: 'google', subject: concurrentSubject, email: 'race@example.com', name: 'Race' }),
    ])
    assert.equal(race1.id, race2.id)
    assert.equal(race2.id, race3.id)
    assert.equal((await pool.query('SELECT count(*) FROM auth_identities WHERE provider = $1 AND provider_subject = $2', ['google', concurrentSubject])).rows[0].count, '1')
    assert.equal((await pool.query('SELECT count(*) FROM users WHERE id = $1', [race1.id])).rows[0].count, '1')
  } finally {
    await pool.end()
  }
})

// FEATURE-001 currency completion gap: CAD, USD, and NULL must all persist
// correctly on every amount-bearing table, and the DB itself must reject any
// value outside the supported set - not just the application layer.
integration('currency persists correctly across subscriptions, evidence, billing_events, and price_observations, including NULL, and the DB rejects unsupported values', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const user = await repository.createUser({ email: 'currency@example.com', name: 'Currency' })
    await repository.authorizeConnection(user.id, createTokenVault({ secret: 'a'.repeat(32) }).encrypt('refresh-token'))

    const cad = await repository.persistParsedEvidence(user.id, receipt('cad-message', 'cad-billing', 19.99, 'CAD'))
    assert.equal(cad.subscription.currency, 'CAD')
    assert.equal(cad.evidence.currency, 'CAD')
    assert.equal(cad.subscription.priceHistory[0].currency, 'CAD')
    assert.equal(cad.subscription.billingHistory[0].currency, 'CAD')

    const usd = await repository.persistParsedEvidence(user.id, receipt('usd-message', 'usd-billing', 9.99, 'USD'))
    assert.equal(usd.subscription.currency, 'USD')

    const unknown = await repository.persistParsedEvidence(user.id, receipt('unknown-message', 'unknown-billing', 4.99, null))
    assert.equal(unknown.subscription.currency, null)
    assert.equal(unknown.evidence.currency, null)
    assert.equal(unknown.subscription.priceHistory[0].currency, null)
    assert.equal(unknown.subscription.billingHistory[0].currency, null)

    // Existing pre-migration rows have no currency evidence and must stay
    // NULL - never backfilled to USD or anything else.
    await pool.query('INSERT INTO subscriptions (user_id, canonical_service, raw_merchant, current_price, source) VALUES ($1, $2, $3, $4, $5)', [user.id, 'Legacy Service', 'legacy-billing', 15, 'Gmail receipt'])
    const legacy = await pool.query('SELECT currency FROM subscriptions WHERE raw_merchant = $1', ['legacy-billing'])
    assert.equal(legacy.rows[0].currency, null)

    const sourceMessage = await pool.query('SELECT id FROM source_messages LIMIT 1')

    await assert.rejects(
      pool.query('INSERT INTO subscriptions (user_id, canonical_service, currency) VALUES ($1, $2, $3)', [user.id, 'Invalid Currency Co', 'EUR']),
      /violates check constraint/,
      'subscriptions should reject an unsupported currency value',
    )
    await assert.rejects(
      pool.query('INSERT INTO evidence (user_id, source_message_id, currency, provenance) VALUES ($1, $2, $3, $4)', [user.id, sourceMessage.rows[0].id, 'EUR', 'confirmed']),
      /violates check constraint/,
      'evidence should reject an unsupported currency value',
    )
    await assert.rejects(
      pool.query('INSERT INTO billing_events (subscription_id, evidence_id, currency) VALUES ($1, $2, $3)', [cad.subscription.id, usd.evidence.id, 'EUR']),
      /violates check constraint/,
      'billing_events should reject an unsupported currency value',
    )
    await assert.rejects(
      pool.query('INSERT INTO price_observations (subscription_id, currency) VALUES ($1, $2)', [cad.subscription.id, 'EUR']),
      /violates check constraint/,
      'price_observations should reject an unsupported currency value',
    )
  } finally {
    await pool.end()
  }
})