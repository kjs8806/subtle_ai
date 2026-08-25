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

// Unlike `receipt` above (cadence: null, used by tests that don't care about
// derived price intelligence), this resolves a real billing_cycle - without
// one, detectPriceChangeEvents has no cadence to annualize against and never
// produces a price_change_events row at all, which the deletion/disconnect
// tests below need populated to prove it actually gets purged.
const receiptWithCadence = (sourceId, amount, canonicalService = 'Netflix', rawMerchant = 'billing') => ({
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

// MVP-BETA-004 (#41): disconnectConnection and deleteAccount, verified
// against a real database rather than assumed correct from reading the FK
// definitions. Migration 012 fixes a real bug found while inspecting the
// schema: a confirmed candidate's resolved_subscription_id had no ON DELETE
// behavior, so deleting the subscription it resolved to (exactly what
// disconnect does) threw a foreign key violation and rolled back the whole
// operation for any user who had ever confirmed one.
integration('disconnectConnection purges every Gmail-derived record (including confirmed/pending candidates and dismissals) without a foreign key violation, and preserves the account', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const vault = createTokenVault({ secret: 'a'.repeat(32) })
    const userA = await repository.createUser({ email: 'a@example.com', name: 'A' })
    const userB = await repository.createUser({ email: 'b@example.com', name: 'B' })
    for (const user of [userA, userB]) {
      await repository.authorizeConnection(user.id, vault.encrypt('refresh-token'))
      const first = await repository.persistParsedEvidence(user.id, receiptWithCadence(`${user.id}-msg-1`, 15))
      await repository.persistParsedEvidence(user.id, receiptWithCadence(`${user.id}-msg-2`, 18))
      await repository.applyCorrection(user.id, first.subscription.id, 'plan', 'Premium')
      // A confirmed candidate - this is exactly the scenario that used to
      // throw "violates foreign key constraint
      // subscription_candidates_resolved_subscription_id_fkey".
      await repository.persistCandidate(user.id, { sourceId: `${user.id}-cand-1`, canonicalService: 'Spotify', rawMerchant: 'billing', amount: 10, currency: 'USD', cadence: 'monthly', nextRenewal: null, receivedAt: '2026-08-19T09:00:00.000Z', excerpt: 'ambiguous' })
      const confirmable = await repository.listCandidates(user.id)
      await repository.confirmCandidate(user.id, confirmable[0].id, {})
      // A second, never-resolved pending candidate, to prove that case is
      // purged too, not only ones that became a subscription.
      await repository.persistCandidate(user.id, { sourceId: `${user.id}-cand-2`, canonicalService: 'Dropbox', rawMerchant: 'billing', amount: 8, currency: 'USD', cadence: 'monthly', nextRenewal: null, receivedAt: '2026-08-19T09:00:00.000Z', excerpt: 'ambiguous 2' })
      const attentionItems = await repository.listAttentionItems(user.id)
      if (attentionItems.length) await repository.dismissAttentionItem(user.id, attentionItems[0].id)
    }

    const countsFor = async (userId) => {
      const subs = await pool.query('SELECT id FROM subscriptions WHERE user_id = $1', [userId])
      const subscriptionIds = subs.rows.map((row) => row.id)
      const scoped = async (table, column = 'user_id') => (await pool.query(`SELECT count(*) FROM ${table} WHERE ${column} = $1`, [userId])).rows[0].count
      const bySubscription = async (table) => subscriptionIds.length ? (await pool.query(`SELECT count(*) FROM ${table} WHERE subscription_id = ANY($1::uuid[])`, [subscriptionIds])).rows[0].count : '0'
      return {
        subscriptions: subs.rowCount,
        evidence: Number(await scoped('evidence')),
        subscriptionCorrections: Number(await scoped('subscription_corrections')),
        subscriptionCandidates: Number(await scoped('subscription_candidates')),
        priceChangeEvents: Number(await scoped('price_change_events')),
        attentionDismissals: Number(await scoped('attention_item_dismissals')),
        sourceConnections: Number(await scoped('source_connections')),
        fieldObservations: Number(await bySubscription('field_observations')),
        priceObservations: Number(await bySubscription('price_observations')),
        billingEvents: Number(await bySubscription('billing_events')),
        subscriptionEvidence: Number(await bySubscription('subscription_evidence')),
        users: Number(await scoped('users', 'id')),
      }
    }

    const beforeA = await countsFor(userA.id)
    assert.ok(beforeA.subscriptions > 0 && beforeA.subscriptionCandidates === 2 && beforeA.priceChangeEvents > 0, 'test setup did not actually populate userA')

    await assert.doesNotReject(repository.disconnectConnection(userA.id), 'disconnectConnection must not throw a foreign key violation for a user with a confirmed candidate')

    const afterA = await countsFor(userA.id)
    for (const [table, count] of Object.entries(afterA)) {
      if (table === 'users') continue
      assert.equal(count, 0, `expected ${table} to be fully purged for userA after disconnect, got ${count}`)
    }
    assert.equal(afterA.users, 1, 'disconnect must preserve the user account itself')

    // userB is completely untouched by userA's disconnect.
    const afterB = await countsFor(userB.id)
    assert.ok(afterB.subscriptions > 0 && afterB.subscriptionCandidates === 2 && afterB.priceChangeEvents > 0, 'userB\'s data must be untouched by userA\'s disconnect')
  } finally {
    await pool.end()
  }
})

integration('deleteAccount purges every user-scoped table including the user and identity rows, and never affects another account', async () => {
  const pool = await connectPool()
  try {
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
    const repository = createPostgresRepository({ pool })
    const vault = createTokenVault({ secret: 'a'.repeat(32) })
    const userC = await repository.resolveOrCreateIdentity({ provider: 'google', subject: 'sub-delete-c', email: 'c@example.com', name: 'C' })
    const userD = await repository.resolveOrCreateIdentity({ provider: 'google', subject: 'sub-delete-d', email: 'd@example.com', name: 'D' })
    for (const user of [userC, userD]) {
      await repository.authorizeConnection(user.id, vault.encrypt('refresh-token'))
      const first = await repository.persistParsedEvidence(user.id, receiptWithCadence(`${user.id}-msg-1`, 15))
      await repository.persistParsedEvidence(user.id, receiptWithCadence(`${user.id}-msg-2`, 18))
      await repository.applyCorrection(user.id, first.subscription.id, 'plan', 'Premium')
      await repository.persistCandidate(user.id, { sourceId: `${user.id}-cand-1`, canonicalService: 'Spotify', rawMerchant: 'billing', amount: 10, currency: 'USD', cadence: 'monthly', nextRenewal: null, receivedAt: '2026-08-19T09:00:00.000Z', excerpt: 'ambiguous' })
      const confirmable = await repository.listCandidates(user.id)
      await repository.confirmCandidate(user.id, confirmable[0].id, {})
    }

    // SEC-041-01 (Security Manager remediation, optional test hardening
    // request): capture the actual row ids for every transitively-related
    // table *before* deletion, so the after-deletion check queries each
    // table directly by those specific ids rather than inferring "0" just
    // because the parent row (subscriptions/source_connections/etc.) is
    // gone. Migration 012 exists precisely because one such transitive FK
    // (subscription_candidates.resolved_subscription_id) turned out to have
    // no ON DELETE behavior at all - inferring purge-by-parent-count-only
    // would never have caught that class of bug; querying the captured ids
    // directly does.
    const captureTransitiveIds = async (userId) => {
      const subs = await pool.query('SELECT id FROM subscriptions WHERE user_id = $1', [userId])
      const connections = await pool.query('SELECT id FROM source_connections WHERE user_id = $1', [userId])
      const subscriptionIds = subs.rows.map((row) => row.id)
      const correctionsRows = subscriptionIds.length ? await pool.query('SELECT id FROM subscription_corrections WHERE subscription_id = ANY($1::uuid[])', [subscriptionIds]) : { rows: [] }
      const candidatesRows = await pool.query('SELECT id FROM subscription_candidates WHERE user_id = $1', [userId])
      return {
        subscriptionIds,
        connectionIds: connections.rows.map((row) => row.id),
        correctionIds: correctionsRows.rows.map((row) => row.id),
        candidateIds: candidatesRows.rows.map((row) => row.id),
      }
    }

    const countAllFor = async (userId, transitiveIds) => {
      const results = {}
      results.users = (await pool.query('SELECT count(*) FROM users WHERE id = $1', [userId])).rows[0].count
      results.auth_identities = (await pool.query('SELECT count(*) FROM auth_identities WHERE user_id = $1', [userId])).rows[0].count
      const directTables = ['source_connections', 'subscriptions', 'evidence', 'subscription_corrections', 'subscription_candidates', 'price_change_events', 'attention_item_dismissals']
      for (const table of directTables) results[table] = (await pool.query(`SELECT count(*) FROM ${table} WHERE user_id = $1`, [userId])).rows[0].count
      const byIds = async (table, column, ids) => ids.length ? (await pool.query(`SELECT count(*) FROM ${table} WHERE ${column} = ANY($1::uuid[])`, [ids])).rows[0].count : '0'
      results.scan_runs = await byIds('scan_runs', 'connection_id', transitiveIds.connectionIds)
      results.source_messages = await byIds('source_messages', 'connection_id', transitiveIds.connectionIds)
      for (const table of ['subscription_evidence', 'billing_events', 'price_observations', 'field_observations']) {
        results[table] = await byIds(table, 'subscription_id', transitiveIds.subscriptionIds)
      }
      results.correction_conflicts = await byIds('correction_conflicts', 'correction_id', transitiveIds.correctionIds)
      results.candidate_evidence = await byIds('candidate_evidence', 'candidate_id', transitiveIds.candidateIds)
      return results
    }

    const transitiveIds = await captureTransitiveIds(userC.id)
    assert.ok(transitiveIds.subscriptionIds.length > 0 && transitiveIds.candidateIds.length === 1 && transitiveIds.connectionIds.length === 1, 'test setup did not actually populate userC')
    const before = await countAllFor(userC.id, transitiveIds)
    assert.ok(Number(before.subscriptions) > 0 && Number(before.subscription_candidates) === 1 && Number(before.auth_identities) === 1, 'test setup did not actually populate userC')

    const result = await repository.deleteAccount(userC.id)
    assert.equal(result.deleted, true)

    const after = await countAllFor(userC.id, transitiveIds)
    for (const [table, count] of Object.entries(after)) assert.equal(Number(count), 0, `expected ${table} to be fully purged for userC after deleteAccount, got ${count}`)

    // Deleting an already-deleted (or never-existed) account is a safe no-op.
    const secondDelete = await repository.deleteAccount(userC.id)
    assert.equal(secondDelete.deleted, false)

    // userD is completely untouched.
    const afterD = await countAllFor(userD.id, await captureTransitiveIds(userD.id))
    assert.equal(Number(afterD.users), 1)
    assert.ok(Number(afterD.subscriptions) > 0 && Number(afterD.subscription_candidates) === 1, 'userD\'s data must be untouched by userC\'s deletion')

    // Re-authenticating with the deleted identity's Google subject creates a
    // genuinely new account, never resurrecting the deleted one.
    const resurrected = await repository.resolveOrCreateIdentity({ provider: 'google', subject: 'sub-delete-c', email: 'c@example.com', name: 'C' })
    assert.notEqual(resurrected.id, userC.id)
    const resurrectedCounts = await countAllFor(resurrected.id, await captureTransitiveIds(resurrected.id))
    assert.equal(Number(resurrectedCounts.subscriptions), 0)
    assert.equal(Number(resurrectedCounts.subscription_candidates), 0)
  } finally {
    await pool.end()
  }
})

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