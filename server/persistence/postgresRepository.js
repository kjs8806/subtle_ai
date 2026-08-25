import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { buildAttentionItems, RULE_VERSION } from '../../src/services/attentionItemBuilder.js'
import { detectPriceChangeEvents } from '../../src/services/priceChangeService.js'

// node-postgres returns NUMERIC columns (current_price, amount, confidence) as
// strings by default, to avoid float-precision loss on arbitrary-precision
// values. This app only ever stores small fixed-scale currency/score values,
// so that precision concern doesn't apply here - and the API contract with the
// frontend expects real numbers (`typeof value === 'number'`), not numeric
// strings, which were being silently treated as missing.
pg.types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)))

const rowConnection = (row) => row && ({ id: row.id, userId: row.user_id, provider: row.provider, status: row.authorization_state, scanStatus: row.scan_state, lastScanAt: row.last_scan_at })

// FEATURE-002: the six fields a user may correct. `field` values match the
// `subscription_corrections.field` CHECK constraint and, not incidentally,
// the literal subscriptions column each one corrects - so this whitelist
// doubles as the safe set of identifiers this file ever interpolates
// directly into an UPDATE ... SET <field> = $1 statement.
const CORRECTION_FIELDS = new Set(['canonical_service', 'plan', 'current_price', 'currency', 'billing_cycle', 'next_renewal'])
// Second-round Tech Lead remediation (GitHub PR #37, BLOCKER 2): every field
// that price-change detection actually reads (priceChangeService.js's
// detectPriceChangeEvents takes currentPrice/currency/cadence) must
// invalidate/recompute derived price intelligence when corrected - not just
// current_price. See applyCorrection below.
const PRICE_INTELLIGENCE_FIELDS = new Set(['current_price', 'currency', 'billing_cycle'])
// Maps a parseReceipt fieldObservations key (camelCase, evidence-facing) to
// the correction field it corresponds to (snake_case, subscriptions-column-facing)
// - used only to detect when freshly scanned evidence conflicts with an
// active user correction on the same underlying subscription field.
const PIPELINE_FIELD_TO_CORRECTION_FIELD = { canonicalService: 'canonical_service', amount: 'current_price', currency: 'currency', cadence: 'billing_cycle', nextRenewal: 'next_renewal' }

const hydrateSubscription = async (pool, row) => {
  if (!row) return null
  const [evidence, priceHistory, billingHistory, fieldObservations, corrections, conflicts] = await Promise.all([
    pool.query('SELECT e.id, e.canonical_service AS "canonicalService", e.raw_merchant AS "rawMerchant", e.amount, e.currency, e.cadence, e.next_renewal AS "nextRenewal", e.confidence, e.provenance, e.excerpt, sm.provider_message_id AS "sourceId", sm.received_at AS "receivedAt" FROM evidence e JOIN subscription_evidence se ON se.evidence_id = e.id JOIN source_messages sm ON sm.id = e.source_message_id WHERE se.subscription_id = $1 ORDER BY e.created_at', [row.id]),
    pool.query('SELECT id, amount, currency, observed_at AS "observedAt" FROM price_observations WHERE subscription_id = $1 ORDER BY observed_at, sequence_id', [row.id]),
    pool.query('SELECT amount, currency, billed_at AS "billedAt", evidence_id AS "evidenceId" FROM billing_events WHERE subscription_id = $1 ORDER BY billed_at', [row.id]),
    pool.query('SELECT field, value, provenance, confidence, evidence_id AS "evidenceId" FROM field_observations WHERE subscription_id = $1 ORDER BY id', [row.id]),
    pool.query('SELECT id, field, value, created_at AS "createdAt" FROM subscription_corrections WHERE subscription_id = $1 AND superseded_at IS NULL ORDER BY created_at', [row.id]),
    pool.query('SELECT cc.id, cc.correction_id AS "correctionId", sc.field, cc.evidence_id AS "evidenceId", cc.conflicting_value AS "conflictingValue", cc.detected_at AS "detectedAt" FROM correction_conflicts cc JOIN subscription_corrections sc ON sc.id = cc.correction_id WHERE sc.subscription_id = $1 AND cc.acknowledged_at IS NULL ORDER BY cc.detected_at', [row.id]),
  ])
  return { id: row.id, userId: row.user_id, canonicalService: row.canonical_service, rawMerchant: row.raw_merchant, plan: row.plan, currentPrice: row.current_price, currency: row.currency, billingCycle: row.billing_cycle, nextRenewal: row.next_renewal, status: row.status, source: row.source, evidence: evidence.rows, priceHistory: priceHistory.rows, billingHistory: billingHistory.rows, fieldObservations: fieldObservations.rows, corrections: corrections.rows, conflicts: conflicts.rows }
}

const evidenceRowMapper = (row) => ({ id: row.id, canonicalService: row.canonical_service, rawMerchant: row.raw_merchant, amount: row.amount, currency: row.currency, cadence: row.cadence, nextRenewal: row.next_renewal, confidence: row.confidence, provenance: row.provenance, excerpt: row.excerpt, createdAt: row.created_at })

// Tech Lead remediation (GitHub PR #37, "Recommended architectural
// cleanup"; second-round remediation, BLOCKER 2): price-change detection/
// persistence happens here, at the point evidence or a correction actually
// changes an input to derived price intelligence - a new Gmail receipt
// (persistParsedEvidence) or a current_price/currency/billing_cycle
// correction (applyCorrection) - never as a side effect of
// GET /api/v1/attention, which only reads what this already persisted.
// Runs inside the caller's transaction (`client`) so the new observation and
// any event(s) it produces commit atomically together.
//
// Recomputes the *entire* transition history from price_observations every
// time rather than trying to detect "just the new one" - detectPriceChangeEvents
// is a pure, cheap function over a small list, and re-deriving the full set
// is simpler and self-healing (a transition that was somehow never
// persisted, or one whose derived numbers went stale, gets caught on the
// next call) than tracking incremental state.
//
// ON CONFLICT (event_key) DO UPDATE, not DO NOTHING: event_key is derived
// only from the observation pair (migrations/010_feature_003_remediation.sql),
// never from cadence/currency/computed values, so a cadence or currency
// correction re-detects the *same* event_key for an already-persisted
// transition but with different derived numbers (a monthly->yearly
// correction changes that event's annual_impact/is_attention_worthy even
// though the underlying prices/observations are unchanged). DO NOTHING would
// silently leave the stale pre-correction numbers in place. previous_price/
// current_price and the observation FKs are never in the UPDATE SET - they
// are immutable facts about the transition itself, and detected_at is left
// alone so it keeps recording when the occurrence was first detected, not
// when it was last recomputed (detected_at is audit metadata only - see
// listAttentionItems below for the actual "current" ordering).
const recordPriceChangeEvents = async (client, userId, subscriptionId) => {
  const subscription = await client.query('SELECT currency, billing_cycle FROM subscriptions WHERE id = $1', [subscriptionId])
  const { currency, billing_cycle: cadence } = subscription.rows[0] || {}
  const priceHistory = await client.query('SELECT id, amount, currency, observed_at AS "observedAt" FROM price_observations WHERE subscription_id = $1 ORDER BY observed_at, sequence_id', [subscriptionId])
  const events = detectPriceChangeEvents({ currency, cadence, priceHistory: priceHistory.rows })
  for (const event of events) {
    const eventKey = `${event.previousObservation.id}:${event.currentObservation.id}`
    await client.query(
      `INSERT INTO price_change_events (user_id, subscription_id, event_key, previous_price_observation_id, current_price_observation_id, change_type, currency, cadence, previous_price, current_price, per_period_delta, percent_change, annual_impact, is_attention_worthy, first_seen_at, rule_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (event_key) DO UPDATE SET
         change_type = EXCLUDED.change_type,
         currency = EXCLUDED.currency,
         cadence = EXCLUDED.cadence,
         per_period_delta = EXCLUDED.per_period_delta,
         percent_change = EXCLUDED.percent_change,
         annual_impact = EXCLUDED.annual_impact,
         is_attention_worthy = EXCLUDED.is_attention_worthy,
         rule_version = EXCLUDED.rule_version`,
      [userId, subscriptionId, eventKey, event.previousObservation.id, event.currentObservation.id, event.changeType, event.currency, event.cadence, event.previousPrice, event.currentPrice, event.perPeriodDelta, event.percentChange, event.annualImpact, event.isAttentionWorthy, event.firstSeenAt, RULE_VERSION],
    )
  }
}

export const createPostgresRepository = ({ pool }) => {
  if (!pool) throw new Error('PostgreSQL pool is required')
  return {
    async getUser(id) { const { rows } = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [id]); return rows[0] || null },
    async createUser({ id = randomUUID(), email, name }) { const { rows } = await pool.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING id, email, name', [id, email, name]); return rows[0] },
    async getIdentityForUser({ userId, provider }) { const { rows } = await pool.query('SELECT provider_subject AS subject, email FROM auth_identities WHERE user_id = $1 AND provider = $2', [userId, provider]); return rows[0] || null },
    async resolveOrCreateIdentity({ provider, subject, email, name }) {
      const existing = await pool.query('SELECT u.id, u.email, u.name FROM auth_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.provider = $1 AND ai.provider_subject = $2', [provider, subject])
      if (existing.rows[0]) return existing.rows[0]
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const created = await client.query('INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name', [email, name])
        const linked = await client.query('INSERT INTO auth_identities (user_id, provider, provider_subject, email) VALUES ($1, $2, $3, $4) ON CONFLICT (provider, provider_subject) DO NOTHING RETURNING id', [created.rows[0].id, provider, subject, email])
        if (linked.rowCount) { await client.query('COMMIT'); return created.rows[0] }
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }
      const winner = await pool.query('SELECT u.id, u.email, u.name FROM auth_identities ai JOIN users u ON u.id = ai.user_id WHERE ai.provider = $1 AND ai.provider_subject = $2', [provider, subject])
      return winner.rows[0]
    },
    async getConnection(userId) { const { rows } = await pool.query('SELECT * FROM source_connections WHERE user_id = $1 AND provider = $2', [userId, 'gmail']); return rowConnection(rows[0]) || { status: 'not_connected', scanStatus: 'idle' } },
    // MVP-BETA-004 (#41, Tech Lead remediation on PR #51; extended for
    // SEC-041-01, Security Manager remediation on PR #51): a connection
    // stuck in 'revoked_pending_purge' (Google-side revocation confirmed on
    // a previous disconnect attempt, but the local purge hadn't completed
    // yet) or 'revoke_requested' (a disconnect was requested - Google may or
    // may not have been reached before a crash/failure - but that was never
    // durably confirmed either way) must finish purging before a new
    // connection is established here - otherwise old, now-orphaned
    // Gmail-derived data would silently persist alongside data from the new
    // connection instead of ever being cleaned up. This makes reconnecting a
    // second, equally valid way to complete a stuck purge, in addition to
    // retrying disconnect directly.
    async authorizeConnection(userId, token = null) {
      const existing = await pool.query('SELECT authorization_state FROM source_connections WHERE user_id = $1 AND provider = $2', [userId, 'gmail'])
      if (['revoked_pending_purge', 'revoke_requested'].includes(existing.rows[0]?.authorization_state)) await this.disconnectConnection(userId)
      const ciphertext = token?.ciphertext || token || null
      const keyVersion = token?.keyVersion || null
      const { rows } = await pool.query('INSERT INTO source_connections (user_id, provider, authorization_state, encrypted_refresh_token, token_key_version) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, provider) DO UPDATE SET authorization_state = $3, encrypted_refresh_token = COALESCE($4, source_connections.encrypted_refresh_token), token_key_version = COALESCE($5, source_connections.token_key_version), scan_state = $6 RETURNING *', [userId, 'gmail', 'connected', ciphertext, keyVersion, 'idle'])
      return rowConnection(rows[0])
    },
    // SEC-041-01 (Security Manager remediation on PR #51): durably records
    // that a Gmail disconnect has begun *before* provider.revokeConnection()
    // is ever called - see server/app.js for the full state-machine
    // rationale. The token is intentionally left in place (only
    // markGmailRevoked clears it) so a retry from this exact state still has
    // a token to send to the provider. Idempotent: a retry that finds the
    // connection already in 'revoke_requested' is a harmless no-op. Never
    // touches a connection already at 'revoked_pending_purge' (or absent) -
    // callers only reach this once they've established the connection isn't
    // already past this point.
    async beginGmailDisconnect(userId) {
      const { rows } = await pool.query("UPDATE source_connections SET authorization_state = 'revoke_requested' WHERE user_id = $1 AND provider = $2 AND authorization_state IN ('connected', 'revoke_requested') RETURNING authorization_state", [userId, 'gmail'])
      return rows[0]?.authorization_state === 'revoke_requested'
    },
    // SEC-041-01: the counterpart to beginGmailDisconnect, for when
    // provider.revokeConnection() comes back with a *definitive* negative
    // answer (it threw, or explicitly returned something other than
    // 'disconnected') rather than an ambiguous one (a crash with no response
    // at all). This is the pre-existing "a genuine revocation failure never
    // purges local data and leaves the connection usable for a retry"
    // guarantee (Tech Lead remediation, PR #51) - reverting the marker here
    // keeps that guarantee intact rather than leaving the connection
    // scan-blocked over a failure that we know, with certainty, never
    // reached Google successfully. Only reverts a connection that is
    // currently 'revoke_requested' - never touches 'revoked_pending_purge',
    // so it can never resurrect one that's actually mid-purge.
    async cancelGmailDisconnect(userId) {
      await pool.query("UPDATE source_connections SET authorization_state = 'connected' WHERE user_id = $1 AND provider = $2 AND authorization_state = 'revoke_requested'", [userId, 'gmail'])
    },
    // The token remains readable through 'revoke_requested' (not just
    // 'connected') - see beginGmailDisconnect above - so a retry that finds
    // the connection already mid-disconnect can still fetch it to re-attempt
    // provider.revokeConnection(). It stops being readable the moment
    // markGmailRevoked nulls it.
    async getEncryptedRefreshToken(userId) { const { rows } = await pool.query("SELECT encrypted_refresh_token AS ciphertext, token_key_version AS \"keyVersion\" FROM source_connections WHERE user_id = $1 AND provider = $2 AND authorization_state IN ('connected', 'revoke_requested')", [userId, 'gmail']); return rows[0]?.ciphertext ? rows[0] : null },
    // Persists that Google-side revocation is confirmed, *before* the local
    // purge is attempted - see disconnectConnection below and the matching
    // comment in server/app.js for why this ordering is the whole point of
    // this remediation. Clearing the token here too means it can never be
    // reused even if the purge that follows fails and is retried later.
    //
    // SEC-041-01: this write itself can still fail (a transient DB error
    // between Google confirming revocation and this UPDATE committing). When
    // it does, this is a plain no-op UPDATE with no state precondition - the
    // caller (server/app.js) wraps it in a bounded number of immediate
    // retries to absorb that without a second call to Google, and if those
    // are also exhausted, the connection simply stays at 'revoke_requested'
    // (written by beginGmailDisconnect before Google was ever contacted),
    // which is itself a safe, recoverable, scan-blocked state - never
    // 'connected' with a token that's secretly already dead at Google.
    async markGmailRevoked(userId) {
      await pool.query("UPDATE source_connections SET authorization_state = 'revoked_pending_purge', encrypted_refresh_token = NULL, token_key_version = NULL WHERE user_id = $1 AND provider = $2", [userId, 'gmail'])
    },
    async beginScan(userId) { const client = await pool.connect(); try { await client.query('BEGIN'); const connection = await client.query('SELECT * FROM source_connections WHERE user_id = $1 AND provider = $2 AND authorization_state = $3 FOR UPDATE', [userId, 'gmail', 'connected']); if (!connection.rows[0]) { await client.query('ROLLBACK'); return null } if (connection.rows[0].scan_state === 'scanning') { await client.query('ROLLBACK'); return { conflict: true } } const scan = await client.query('INSERT INTO scan_runs (connection_id, status) VALUES ($1, $2) RETURNING *', [connection.rows[0].id, 'scanning']); await client.query('UPDATE source_connections SET scan_state = $1 WHERE id = $2', ['scanning', connection.rows[0].id]); await client.query('COMMIT'); return { id: scan.rows[0].id, userId, status: 'scanning', startedAt: scan.rows[0].started_at, completedAt: null, found: 0 } } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() } },
    async completeScan(userId, scanId, found, status = 'complete') { const { rows } = await pool.query('UPDATE scan_runs s SET status = $1, found_count = $2, completed_at = now() FROM source_connections c WHERE s.id = $3 AND s.connection_id = c.id AND c.user_id = $4 RETURNING s.*, c.id AS connection_id', [status, found, scanId, userId]); if (!rows[0]) return null; await pool.query('UPDATE source_connections SET scan_state = $1, last_scan_at = now() WHERE id = $2', [status === 'failed' ? 'error' : 'idle', rows[0].connection_id]); return { id: rows[0].id, userId, status: rows[0].status, startedAt: rows[0].started_at, completedAt: rows[0].completed_at, found: rows[0].found_count } },
    async persistParsedEvidence(userId, parsed) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const connection = await client.query('SELECT id FROM source_connections WHERE user_id = $1 AND provider = $2 AND authorization_state = $3 FOR UPDATE', [userId, 'gmail', 'connected'])
        if (!connection.rows[0]) throw new Error('Connected source required')
        const source = await client.query('INSERT INTO source_messages (connection_id, provider_message_id, received_at) VALUES ($1, $2, $3) ON CONFLICT (connection_id, provider_message_id) DO UPDATE SET provider_message_id = EXCLUDED.provider_message_id RETURNING id', [connection.rows[0].id, parsed.sourceId, parsed.receivedAt])
        const existing = await client.query('SELECT e.id, e.canonical_service, se.subscription_id FROM evidence e JOIN subscription_evidence se ON se.evidence_id = e.id WHERE e.source_message_id = $1', [source.rows[0].id])
        if (existing.rows[0]) { await client.query('COMMIT'); return { created: false, evidence: existing.rows[0], subscription: await this.getSubscription(userId, existing.rows[0].subscription_id) } }
        const candidates = await client.query('SELECT id FROM subscriptions WHERE user_id = $1 AND canonical_service = $2 AND raw_merchant = $3', [userId, parsed.canonicalService, parsed.rawMerchant])
        if (candidates.rowCount > 1) { await client.query('ROLLBACK'); return { created: false, ambiguous: true } }
        const subscriptionId = candidates.rows[0]?.id || randomUUID()
        // FEATURE-002: an active correction on a field takes precedence over
        // new scan evidence for that field - fetch the subscription's active
        // corrections (only relevant when enriching an existing row; a brand
        // new subscription cannot have any yet) so the column update below can
        // suppress exactly those fields, and so conflicts can be detected
        // after the new evidence row exists.
        const activeCorrections = candidates.rows[0]
          ? (await client.query('SELECT id, field, value FROM subscription_corrections WHERE subscription_id = $1 AND superseded_at IS NULL', [subscriptionId])).rows
          : []
        const correctionByField = Object.fromEntries(activeCorrections.map((row) => [row.field, row]))
        // parseReceipt's currency gate guarantees amount and currency are
        // always jointly null or jointly resolved for anything reaching this
        // point - current_price and currency are always updated together so
        // they can never drift out of sync with each other, except that a
        // field with an active correction is never overwritten by new evidence.
        if (!candidates.rows[0]) await client.query('INSERT INTO subscriptions (id, user_id, canonical_service, raw_merchant, current_price, currency, billing_cycle, next_renewal, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)', [subscriptionId, userId, parsed.canonicalService, parsed.rawMerchant, parsed.amount, parsed.currency, parsed.cadence, parsed.nextRenewal, 'Gmail receipt'])
        else await client.query('UPDATE subscriptions SET current_price = COALESCE($1, current_price), currency = COALESCE($2, currency), billing_cycle = COALESCE($3, billing_cycle), next_renewal = COALESCE($4, next_renewal) WHERE id = $5 AND user_id = $6', [
          correctionByField.current_price ? null : parsed.amount,
          correctionByField.currency ? null : parsed.currency,
          correctionByField.billing_cycle ? null : parsed.cadence,
          correctionByField.next_renewal ? null : parsed.nextRenewal,
          subscriptionId, userId,
        ])
        const evidence = await client.query('INSERT INTO evidence (user_id, source_message_id, canonical_service, raw_merchant, amount, currency, cadence, next_renewal, confidence, provenance, excerpt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *', [userId, source.rows[0].id, parsed.canonicalService, parsed.rawMerchant, parsed.amount, parsed.currency, parsed.cadence, parsed.nextRenewal, parsed.confidence.score, parsed.confidence.state, parsed.excerpt])
        await client.query('INSERT INTO subscription_evidence (subscription_id, evidence_id) VALUES ($1, $2)', [subscriptionId, evidence.rows[0].id])
        for (const [pipelineField, correctionField] of Object.entries(PIPELINE_FIELD_TO_CORRECTION_FIELD)) {
          const observation = parsed.fieldObservations?.[pipelineField]
          const correction = correctionByField[correctionField]
          if (!observation || observation.value === null || observation.value === undefined || !correction) continue
          if (JSON.stringify(observation.value) !== JSON.stringify(correction.value)) {
            await client.query('INSERT INTO correction_conflicts (correction_id, evidence_id, conflicting_value) VALUES ($1, $2, $3)', [correction.id, evidence.rows[0].id, JSON.stringify(observation.value)])
          }
        }
        await client.query('INSERT INTO billing_events (subscription_id, evidence_id, amount, currency, billed_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (subscription_id, evidence_id) DO NOTHING', [subscriptionId, evidence.rows[0].id, parsed.amount, parsed.currency, parsed.receivedAt])
        await client.query('INSERT INTO price_observations (subscription_id, evidence_id, amount, currency, observed_at) VALUES ($1, $2, $3, $4, $5)', [subscriptionId, evidence.rows[0].id, parsed.amount, parsed.currency, parsed.receivedAt])
        for (const [field, observation] of Object.entries(parsed.fieldObservations || {})) await client.query('INSERT INTO field_observations (subscription_id, field, value, provenance, confidence, evidence_id) VALUES ($1, $2, $3, $4, $5, $6)', [subscriptionId, field, JSON.stringify(observation.value ?? null), observation.provenance, parsed.confidence.score, evidence.rows[0].id])
        await recordPriceChangeEvents(client, userId, subscriptionId)
        await client.query('COMMIT')
        return { created: true, evidence: evidence.rows[0], subscription: await this.getSubscription(userId, subscriptionId) }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    // MVP-BETA-004 (#41, Product Owner policy on issue #41): disconnecting
    // Gmail purges every Gmail-derived record but preserves the user, the
    // auth identity, and (today, since manual subscriptions have no backend
    // record at all - they live only in browser memory) the rest of the
    // account is untouched by definition. Every table currently reachable
    // from a Gmail scan gets an explicit DELETE here rather than relying on
    // ON DELETE CASCADE alone - this is a surgical purge of one user's data,
    // not a delete of the `users` row those cascades are rooted on, so
    // nothing cascades unless it's declared for a table this function
    // already touches directly.
    //
    // Two gaps existed here before this fix, found by inspecting every
    // table's actual FK behavior rather than assuming CASCADE was enough:
    // 1. subscription_candidates/candidate_evidence (FEATURE-002's ambiguous-
    //    candidate review) were never purged. Every candidate is Gmail-
    //    derived the same as every subscription is (there is no other
    //    scan source), and a confirmed candidate's resolved_subscription_id
    //    pointed at a subscription this function was about to delete with no
    //    ON DELETE behavior on that FK (migration 012 fixes the column to
    //    SET NULL) - reproduced against a real database, any user who had
    //    ever confirmed a candidate got a foreign key violation on
    //    disconnect and the whole transaction rolled back.
    // 2. attention_item_dismissals (FEATURE-003) has no FK back to
    //    subscriptions or price_change_events at all (item_key is a
    //    synthetic string, not a foreign key - see migration 009) so it was
    //    never cleaned up by any cascade and needs an explicit purge too.
    async disconnectConnection(userId) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const connections = await client.query('SELECT id FROM source_connections WHERE user_id = $1 AND provider = $2', [userId, 'gmail'])
        const connectionIds = connections.rows.map(({ id }) => id)
        if (connectionIds.length) {
          await client.query('DELETE FROM candidate_evidence WHERE candidate_id IN (SELECT id FROM subscription_candidates WHERE user_id = $1)', [userId])
          await client.query('DELETE FROM subscription_candidates WHERE user_id = $1', [userId])
          await client.query('DELETE FROM attention_item_dismissals WHERE user_id = $1', [userId])
          await client.query('DELETE FROM field_observations WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM price_observations WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM billing_events WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM subscription_evidence WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM subscriptions WHERE user_id = $1 AND source = $2', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM evidence WHERE source_message_id IN (SELECT id FROM source_messages WHERE connection_id = ANY($1::uuid[]))', [connectionIds])
          await client.query('DELETE FROM source_messages WHERE connection_id = ANY($1::uuid[])', [connectionIds])
          await client.query('DELETE FROM scan_runs WHERE connection_id = ANY($1::uuid[])', [connectionIds])
          await client.query('DELETE FROM source_connections WHERE id = ANY($1::uuid[])', [connectionIds])
        }
        await client.query('COMMIT')
        return { status: 'not_connected', scanStatus: 'idle' }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    // MVP-BETA-004 (#41): full account deletion. Every user-scoped table was
    // individually verified (not assumed) to cascade from `users` via
    // ON DELETE CASCADE, directly or transitively, except
    // subscription_candidates.resolved_subscription_id - migration 012 fixed
    // that gap the same disconnectConnection needed fixed. A single DELETE
    // FROM users is therefore both correct and atomic: every dependent
    // row is removed as part of the same statement's cascade resolution,
    // so there is no window where a partial purge could be observed.
    async deleteAccount(userId) {
      const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [userId])
      return { deleted: rowCount > 0 }
    },
    // Rejected subscriptions are excluded from the default listing (and, by
    // extension, from any spend total derived from it) but are never deleted
    // - getSubscription (used for direct-by-id lookups) intentionally does
    // not filter by status, so a rejected record remains inspectable.
    async listSubscriptions(userId) { const { rows } = await pool.query("SELECT * FROM subscriptions WHERE user_id = $1 AND status != 'rejected' ORDER BY created_at", [userId]); return Promise.all(rows.map((row) => hydrateSubscription(pool, row))) },
    async getSubscription(userId, id) { const { rows } = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1 AND id = $2', [userId, id]); return hydrateSubscription(pool, rows[0]) },

    // FEATURE-002: user-entered corrections, subscription rejection, and
    // ambiguous-candidate review. Every method below resolves ownership from
    // the caller-supplied `userId` (the internal UUID derived from the
    // session) - never from a client-supplied id on the record itself.
    async applyCorrection(userId, subscriptionId, field, value) {
      if (!CORRECTION_FIELDS.has(field)) throw new Error(`Invalid correction field: ${field}`)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const owned = await client.query('SELECT id, currency FROM subscriptions WHERE user_id = $1 AND id = $2 FOR UPDATE', [userId, subscriptionId])
        if (!owned.rows[0]) { await client.query('ROLLBACK'); return null }
        await client.query('UPDATE subscription_corrections SET superseded_at = now() WHERE subscription_id = $1 AND field = $2 AND superseded_at IS NULL', [subscriptionId, field])
        await client.query('INSERT INTO subscription_corrections (subscription_id, user_id, field, value) VALUES ($1, $2, $3, $4)', [subscriptionId, userId, field, JSON.stringify(value)])
        // `field` is drawn only from CORRECTION_FIELDS above, never from
        // unvalidated caller input, so interpolating it as a column name here
        // is safe.
        await client.query(`UPDATE subscriptions SET ${field} = $1 WHERE id = $2`, [value, subscriptionId])
        // A price correction has no receipt behind it, but it still needs to
        // participate in the same observation-pair identity model as every
        // other price change (evidence_id stays NULL - see
        // migrations/010_feature_003_remediation.sql) rather than needing a
        // second, correction-specific identity scheme.
        if (field === 'current_price') {
          await client.query('INSERT INTO price_observations (subscription_id, evidence_id, amount, currency, observed_at) VALUES ($1, NULL, $2, $3, now())', [subscriptionId, value, owned.rows[0].currency])
        }
        // Second-round Tech Lead remediation (BLOCKER 2): currency and
        // billing_cycle are also inputs to derived price intelligence
        // (annualization, same-currency comparison) - correcting either one
        // must invalidate/recompute stale derived numbers, not just a price
        // correction. Neither needs a new price_observations row (no new
        // price fact was observed, only how to interpret the existing ones
        // changed) - recordPriceChangeEvents re-derives every event from the
        // unchanged observation history under the corrected currency/cadence
        // and self-heals any row whose numbers are now stale (see its own
        // comment above on ON CONFLICT ... DO UPDATE).
        if (PRICE_INTELLIGENCE_FIELDS.has(field)) {
          await recordPriceChangeEvents(client, userId, subscriptionId)
        }
        await client.query('COMMIT')
        return { subscription: await this.getSubscription(userId, subscriptionId) }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async rejectSubscription(userId, subscriptionId) {
      const { rows } = await pool.query("UPDATE subscriptions SET status = 'rejected' WHERE user_id = $1 AND id = $2 RETURNING id", [userId, subscriptionId])
      if (!rows[0]) return null
      return this.getSubscription(userId, subscriptionId)
    },
    async acceptConflict(userId, conflictId) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const row = await client.query('SELECT cc.conflicting_value AS "conflictingValue", sc.id AS "correctionId", sc.field, sc.subscription_id AS "subscriptionId", s.user_id AS "userId" FROM correction_conflicts cc JOIN subscription_corrections sc ON sc.id = cc.correction_id JOIN subscriptions s ON s.id = sc.subscription_id WHERE cc.id = $1 FOR UPDATE', [conflictId])
        if (!row.rows[0] || row.rows[0].userId !== userId) { await client.query('ROLLBACK'); return null }
        const { field, subscriptionId, conflictingValue } = row.rows[0]
        await client.query('UPDATE subscription_corrections SET superseded_at = now() WHERE subscription_id = $1 AND field = $2 AND superseded_at IS NULL', [subscriptionId, field])
        await client.query('INSERT INTO subscription_corrections (subscription_id, user_id, field, value) VALUES ($1, $2, $3, $4)', [subscriptionId, userId, field, JSON.stringify(conflictingValue)])
        await client.query(`UPDATE subscriptions SET ${field} = $1 WHERE id = $2`, [conflictingValue, subscriptionId])
        await client.query('UPDATE correction_conflicts SET acknowledged_at = now() WHERE id = $1', [conflictId])
        // Same reasoning as applyCorrection above (BLOCKER 2): accepting a
        // conflict is itself a correction (it supersedes the prior one with
        // the conflicting value, via the same subscription_corrections
        // trail) and can change currency/billing_cycle/current_price just
        // like a direct correction can - no new price_observations row is
        // needed here specifically because the conflicting value's own
        // observation was already inserted when the evidence that raised
        // this conflict was first persisted (persistParsedEvidence always
        // inserts a price_observations row, whether or not it wins the
        // subscriptions column update).
        if (PRICE_INTELLIGENCE_FIELDS.has(field)) {
          await recordPriceChangeEvents(client, userId, subscriptionId)
        }
        await client.query('COMMIT')
        return { subscription: await this.getSubscription(userId, subscriptionId) }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async dismissConflict(userId, conflictId) {
      const { rows } = await pool.query('UPDATE correction_conflicts cc SET acknowledged_at = now() FROM subscription_corrections sc, subscriptions s WHERE cc.id = $1 AND cc.correction_id = sc.id AND sc.subscription_id = s.id AND s.user_id = $2 AND cc.acknowledged_at IS NULL RETURNING cc.id', [conflictId, userId])
      return rows[0] ? { conflictId: rows[0].id } : null
    },

    // Ambiguous candidates (parseReceipt's `candidate` sketch). A candidate is
    // never counted as an active subscription or spend - it lives entirely in
    // its own tables, never as a filtered row of `subscriptions`.
    async persistCandidate(userId, parsed) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const connection = await client.query('SELECT id FROM source_connections WHERE user_id = $1 AND provider = $2 AND authorization_state = $3 FOR UPDATE', [userId, 'gmail', 'connected'])
        if (!connection.rows[0]) throw new Error('Connected source required')
        const source = await client.query('INSERT INTO source_messages (connection_id, provider_message_id, received_at) VALUES ($1, $2, $3) ON CONFLICT (connection_id, provider_message_id) DO UPDATE SET provider_message_id = EXCLUDED.provider_message_id RETURNING id', [connection.rows[0].id, parsed.sourceId, parsed.receivedAt])
        const existing = await client.query('SELECT id FROM evidence WHERE source_message_id = $1', [source.rows[0].id])
        if (existing.rows[0]) { await client.query('COMMIT'); return { created: false } }
        const candidateRow = await client.query('SELECT id FROM subscription_candidates WHERE user_id = $1 AND canonical_service = $2 AND raw_merchant = $3', [userId, parsed.canonicalService, parsed.rawMerchant])
        const candidateId = candidateRow.rows[0]?.id || randomUUID()
        if (!candidateRow.rows[0]) await client.query('INSERT INTO subscription_candidates (id, user_id, canonical_service, raw_merchant) VALUES ($1, $2, $3, $4)', [candidateId, userId, parsed.canonicalService, parsed.rawMerchant])
        const evidence = await client.query('INSERT INTO evidence (user_id, source_message_id, canonical_service, raw_merchant, amount, currency, cadence, next_renewal, provenance, excerpt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id', [userId, source.rows[0].id, parsed.canonicalService, parsed.rawMerchant, parsed.amount, parsed.currency, parsed.cadence, parsed.nextRenewal, 'inferred', parsed.excerpt])
        await client.query('INSERT INTO candidate_evidence (candidate_id, evidence_id) VALUES ($1, $2)', [candidateId, evidence.rows[0].id])
        await client.query('COMMIT')
        return { created: true, candidateId, evidenceId: evidence.rows[0].id }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async listCandidates(userId) {
      const { rows } = await pool.query("SELECT * FROM subscription_candidates WHERE user_id = $1 AND status = 'pending' ORDER BY created_at", [userId])
      return Promise.all(rows.map(async (row) => {
        const evidenceRows = await pool.query('SELECT id, canonical_service, raw_merchant, amount, currency, cadence, next_renewal, confidence, provenance, excerpt, created_at FROM evidence e JOIN candidate_evidence ce ON ce.evidence_id = e.id WHERE ce.candidate_id = $1 ORDER BY e.created_at', [row.id])
        return { id: row.id, userId: row.user_id, canonicalService: row.canonical_service, rawMerchant: row.raw_merchant, status: row.status, createdAt: row.created_at, evidence: evidenceRows.rows.map(evidenceRowMapper) }
      }))
    },
    async confirmCandidate(userId, candidateId, overrides = {}) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const candidate = await client.query('SELECT * FROM subscription_candidates WHERE user_id = $1 AND id = $2 FOR UPDATE', [userId, candidateId])
        if (!candidate.rows[0]) { await client.query('ROLLBACK'); return null }
        if (candidate.rows[0].status !== 'pending') { await client.query('ROLLBACK'); return { error: 'invalid_state' } }
        const evidenceRows = await client.query('SELECT * FROM evidence e JOIN candidate_evidence ce ON ce.evidence_id = e.id WHERE ce.candidate_id = $1 ORDER BY e.created_at', [candidateId])
        const latest = evidenceRows.rows.at(-1)
        const existing = await client.query('SELECT id FROM subscriptions WHERE user_id = $1 AND canonical_service = $2 AND raw_merchant = $3', [userId, candidate.rows[0].canonical_service, candidate.rows[0].raw_merchant])
        const subscriptionId = existing.rows[0]?.id || randomUUID()
        const currentPrice = overrides.currentPrice ?? latest?.amount ?? null
        const currency = overrides.currency ?? latest?.currency ?? null
        const billingCycle = overrides.billingCycle ?? latest?.cadence ?? null
        const nextRenewal = overrides.nextRenewal ?? latest?.next_renewal ?? null
        const plan = overrides.plan ?? null
        if (!existing.rows[0]) {
          await client.query('INSERT INTO subscriptions (id, user_id, canonical_service, raw_merchant, plan, current_price, currency, billing_cycle, next_renewal, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [subscriptionId, userId, candidate.rows[0].canonical_service, candidate.rows[0].raw_merchant, plan, currentPrice, currency, billingCycle, nextRenewal, 'Gmail receipt'])
        } else {
          // Confirming a candidate is a deliberate, explicit user action on a
          // specific candidate they are looking at - unlike automatic scan
          // reprocessing (persistParsedEvidence), which must never resurrect
          // a rejected subscription, this must always produce a visible
          // active subscription, even when it reuses a row that had
          // previously been rejected.
          await client.query("UPDATE subscriptions SET current_price = COALESCE($1, current_price), currency = COALESCE($2, currency), billing_cycle = COALESCE($3, billing_cycle), next_renewal = COALESCE($4, next_renewal), plan = COALESCE($5, plan), status = 'active' WHERE id = $6 AND user_id = $7", [currentPrice, currency, billingCycle, nextRenewal, plan, subscriptionId, userId])
        }
        for (const ev of evidenceRows.rows) {
          await client.query('INSERT INTO subscription_evidence (subscription_id, evidence_id) VALUES ($1, $2) ON CONFLICT (subscription_id, evidence_id) DO NOTHING', [subscriptionId, ev.id])
          for (const [field, value] of [['canonicalService', ev.canonical_service], ['amount', ev.amount], ['currency', ev.currency], ['cadence', ev.cadence], ['nextRenewal', ev.next_renewal]]) {
            if (value !== null && value !== undefined) await client.query('INSERT INTO field_observations (subscription_id, field, value, provenance, confidence, evidence_id) VALUES ($1, $2, $3, $4, $5, $6)', [subscriptionId, field, JSON.stringify(value), 'inferred', null, ev.id])
          }
        }
        await client.query('UPDATE subscription_candidates SET status = $1, resolved_subscription_id = $2, resolved_at = now() WHERE id = $3', ['confirmed', subscriptionId, candidateId])
        await client.query('COMMIT')
        return { subscription: await this.getSubscription(userId, subscriptionId) }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async rejectCandidate(userId, candidateId) {
      const updated = await pool.query("UPDATE subscription_candidates SET status = 'rejected', resolved_at = now() WHERE user_id = $1 AND id = $2 AND status != 'confirmed' RETURNING id", [userId, candidateId])
      if (updated.rows[0]) return { candidateId: updated.rows[0].id }
      const existing = await pool.query('SELECT status FROM subscription_candidates WHERE user_id = $1 AND id = $2', [userId, candidateId])
      if (!existing.rows[0]) return null
      return { error: 'invalid_state' }
    },

    // FEATURE-003: price-change/renewal intelligence, mixed with FEATURE-002's
    // existing ambiguous-candidate review into one Worth-your-attention list.
    // Every attention-worthy price change detected on this call is durably
    // upserted into price_change_events first (Tech Lead guidance: derived
    // intelligence is persisted, not recalculated ad hoc) - the natural key
    // (subscription_id, previous_price, current_price, currency) makes this
    // idempotent, so a rescan re-detecting the identical transition is a
    // no-op rather than a duplicate row. Renewal items have no discrete
    // "event" of their own (see migrations/009's comment), so nothing is
    // persisted for those beyond an eventual dismissal.
    // Tech Lead remediation (GitHub PR #37, "Recommended architectural
    // cleanup"): a pure read - detection and persistence already happened
    // where the underlying evidence/correction was written (see
    // recordPriceChangeEvents, called from persistParsedEvidence and
    // applyCorrection above). This endpoint no longer has any INSERT/upsert
    // side effect.
    //
    // Second-round remediation, BLOCKER 1: "the current occurrence" per
    // subscription is ordered by the *current* observation's real-world
    // observed_at (falling back to its insertion-order sequence_id - never
    // its random-uuid id - to break an exact tie; see migrations/
    // 011_feature_003_observation_ordering.sql), not by detected_at -
    // detected_at is when this row was (last) written, which
    // is audit metadata only. Postgres's now()/CURRENT_TIMESTAMP is
    // transaction-stable, so recordPriceChangeEvents inserting several
    // historical events in one transaction (e.g. a bulk-seeded price history
    // recomputed in one pass) can give them identical detected_at values -
    // ordering by that would let the DB pick an arbitrary one instead of the
    // chronologically latest transition.
    //
    // BLOCKER 2: an event is only eligible as "current" when its currency
    // and cadence still match the *live* subscription's - a currency or
    // billing_cycle correction is a subscription-level fact, and
    // recordPriceChangeEvents already recomputes/self-heals every reachable
    // event under the corrected value on write, but a currency correction
    // can leave *zero* same-currency history to recompute against (old
    // receipts are never relabeled - see recordPriceChangeEvents/
    // applyCorrection above), in which case the old, now-foreign-currency
    // event row is simply never revisited by that recompute. This filter is
    // the read-time backstop that guarantees a live attention item can never
    // contradict the subscription's current corrected currency/cadence,
    // regardless of what write-time recomputation did or didn't reach.
    async listAttentionItems(userId) {
      const [subscriptions, candidates, latestEvents, dismissed] = await Promise.all([
        this.listSubscriptions(userId),
        this.listCandidates(userId),
        pool.query(
          `SELECT DISTINCT ON (pce.subscription_id)
             pce.subscription_id AS "subscriptionId", pce.event_key AS "eventKey", pce.change_type AS "changeType",
             pce.currency, pce.cadence, pce.previous_price AS "previousPrice", pce.current_price AS "currentPrice",
             pce.per_period_delta AS "perPeriodDelta", pce.percent_change AS "percentChange", pce.annual_impact AS "annualImpact",
             pce.is_attention_worthy AS "isAttentionWorthy", pce.first_seen_at AS "firstSeenAt"
           FROM price_change_events pce
           JOIN price_observations cur ON cur.id = pce.current_price_observation_id
           JOIN subscriptions s ON s.id = pce.subscription_id
           WHERE pce.user_id = $1 AND pce.currency = s.currency AND pce.cadence = s.billing_cycle
           ORDER BY pce.subscription_id, cur.observed_at DESC, cur.sequence_id DESC`,
          [userId],
        ),
        pool.query('SELECT item_key FROM attention_item_dismissals WHERE user_id = $1', [userId]),
      ])
      const dismissedKeys = new Set(dismissed.rows.map((row) => row.item_key))
      return buildAttentionItems({ subscriptions, priceChangeEvents: latestEvents.rows, candidates, isDismissed: (id) => dismissedKeys.has(id) })
    },
    async dismissAttentionItem(userId, itemKey) {
      await pool.query('INSERT INTO attention_item_dismissals (user_id, item_key) VALUES ($1, $2) ON CONFLICT (user_id, item_key) DO NOTHING', [userId, itemKey])
      return { itemKey, dismissed: true }
    },
  }
}