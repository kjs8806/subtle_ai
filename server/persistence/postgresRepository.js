import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { PriceChangeService } from '../../src/services/priceChangeService.js'

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
// Maps a parseReceipt fieldObservations key (camelCase, evidence-facing) to
// the correction field it corresponds to (snake_case, subscriptions-column-facing)
// - used only to detect when freshly scanned evidence conflicts with an
// active user correction on the same underlying subscription field.
const PIPELINE_FIELD_TO_CORRECTION_FIELD = { canonicalService: 'canonical_service', amount: 'current_price', currency: 'currency', cadence: 'billing_cycle', nextRenewal: 'next_renewal' }

const hydrateSubscription = async (pool, row) => {
  if (!row) return null
  const [evidence, priceHistory, billingHistory, fieldObservations, corrections, conflicts] = await Promise.all([
    pool.query('SELECT e.id, e.canonical_service AS "canonicalService", e.raw_merchant AS "rawMerchant", e.amount, e.currency, e.cadence, e.next_renewal AS "nextRenewal", e.confidence, e.provenance, e.excerpt, sm.provider_message_id AS "sourceId", sm.received_at AS "receivedAt" FROM evidence e JOIN subscription_evidence se ON se.evidence_id = e.id JOIN source_messages sm ON sm.id = e.source_message_id WHERE se.subscription_id = $1 ORDER BY e.created_at', [row.id]),
    pool.query('SELECT amount, currency, observed_at AS "observedAt" FROM price_observations WHERE subscription_id = $1 ORDER BY observed_at', [row.id]),
    pool.query('SELECT amount, currency, billed_at AS "billedAt", evidence_id AS "evidenceId" FROM billing_events WHERE subscription_id = $1 ORDER BY billed_at', [row.id]),
    pool.query('SELECT field, value, provenance, confidence, evidence_id AS "evidenceId" FROM field_observations WHERE subscription_id = $1 ORDER BY id', [row.id]),
    pool.query('SELECT id, field, value, created_at AS "createdAt" FROM subscription_corrections WHERE subscription_id = $1 AND superseded_at IS NULL ORDER BY created_at', [row.id]),
    pool.query('SELECT cc.id, cc.correction_id AS "correctionId", sc.field, cc.evidence_id AS "evidenceId", cc.conflicting_value AS "conflictingValue", cc.detected_at AS "detectedAt" FROM correction_conflicts cc JOIN subscription_corrections sc ON sc.id = cc.correction_id WHERE sc.subscription_id = $1 AND cc.acknowledged_at IS NULL ORDER BY cc.detected_at', [row.id]),
  ])
  return { id: row.id, userId: row.user_id, canonicalService: row.canonical_service, rawMerchant: row.raw_merchant, plan: row.plan, currentPrice: row.current_price, currency: row.currency, billingCycle: row.billing_cycle, nextRenewal: row.next_renewal, status: row.status, source: row.source, evidence: evidence.rows, priceHistory: priceHistory.rows, billingHistory: billingHistory.rows, fieldObservations: fieldObservations.rows, corrections: corrections.rows, conflicts: conflicts.rows }
}

const evidenceRowMapper = (row) => ({ id: row.id, canonicalService: row.canonical_service, rawMerchant: row.raw_merchant, amount: row.amount, currency: row.currency, cadence: row.cadence, nextRenewal: row.next_renewal, confidence: row.confidence, provenance: row.provenance, excerpt: row.excerpt, createdAt: row.created_at })

// price_change_events stores its cents columns as BIGINT (OID 20) so the
// increase/decrease math itself is never at risk of float precision loss.
// node-postgres returns bigint as a string by default (app-wide, since
// COUNT(*) and other unrelated bigint results elsewhere rely on that
// default) - these three columns are always small cents amounts well within
// Number.MAX_SAFE_INTEGER, so they are converted to real numbers here,
// narrowly, rather than by overriding the global bigint type parser.
const toNumberOrNull = (value) => (value === null || value === undefined ? null : Number(value))

// FEATURE-003: a joined price_change_events + subscriptions row (see
// listMaterialPriceChangeEvents) - the event carries its own money/rule
// fields, while canonicalService/billingCycle come from the subscription it
// belongs to (never fabricated onto the event itself).
const priceChangeEventRowMapper = (row) => ({
  id: row.id,
  userId: row.user_id,
  subscriptionId: row.subscription_id,
  canonicalService: row.canonical_service,
  billingCycle: row.billing_cycle,
  previousEvidenceId: row.previous_evidence_id,
  evidenceId: row.evidence_id,
  currency: row.currency,
  previousPriceCents: toNumberOrNull(row.previous_price_cents),
  currentPriceCents: toNumberOrNull(row.current_price_cents),
  direction: row.direction,
  percentChangeBp: row.percent_change_bp,
  annualizedDeltaCents: toNumberOrNull(row.annualized_delta_cents),
  isMaterial: row.is_material,
  ruleVersion: row.rule_version,
  detectedAt: row.detected_at,
})

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
    async authorizeConnection(userId, token = null) { const ciphertext = token?.ciphertext || token || null; const keyVersion = token?.keyVersion || null; const { rows } = await pool.query('INSERT INTO source_connections (user_id, provider, authorization_state, encrypted_refresh_token, token_key_version) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, provider) DO UPDATE SET authorization_state = $3, encrypted_refresh_token = COALESCE($4, source_connections.encrypted_refresh_token), token_key_version = COALESCE($5, source_connections.token_key_version), scan_state = $6 RETURNING *', [userId, 'gmail', 'connected', ciphertext, keyVersion, 'idle']); return rowConnection(rows[0]) },
    async getEncryptedRefreshToken(userId) { const { rows } = await pool.query('SELECT encrypted_refresh_token AS ciphertext, token_key_version AS "keyVersion" FROM source_connections WHERE user_id = $1 AND provider = $2 AND authorization_state = $3', [userId, 'gmail', 'connected']); return rows[0]?.ciphertext ? rows[0] : null },
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
        const priceObservation = await client.query('INSERT INTO price_observations (subscription_id, evidence_id, amount, currency, observed_at) VALUES ($1, $2, $3, $4, $5) RETURNING id', [subscriptionId, evidence.rows[0].id, parsed.amount, parsed.currency, parsed.receivedAt])
        for (const [field, observation] of Object.entries(parsed.fieldObservations || {})) await client.query('INSERT INTO field_observations (subscription_id, field, value, provenance, confidence, evidence_id) VALUES ($1, $2, $3, $4, $5, $6)', [subscriptionId, field, JSON.stringify(observation.value ?? null), observation.provenance, parsed.confidence.score, evidence.rows[0].id])

        // FEATURE-003: detect a price-change event between this brand-new
        // observation and the subscription's immediately-preceding one (if
        // any), inside this same transaction. Cadence is read from the
        // subscriptions row *after* the correction-precedence-aware
        // update/insert above, so an active billing_cycle correction is
        // honored automatically - this never re-reads raw evidence for that.
        const priorObservation = await client.query('SELECT amount, currency, evidence_id AS "evidenceId" FROM price_observations WHERE subscription_id = $1 AND id != $2 ORDER BY observed_at', [subscriptionId, priceObservation.rows[0].id])
        const previousObservation = priorObservation.rows.at(-1) || null
        const subscriptionCadence = await client.query('SELECT billing_cycle FROM subscriptions WHERE id = $1', [subscriptionId])
        const priceChange = PriceChangeService.detect({
          previousObservation,
          currentObservation: { amount: parsed.amount, currency: parsed.currency },
          cadence: subscriptionCadence.rows[0]?.billing_cycle ?? null,
        })
        if (priceChange) {
          await client.query(
            'INSERT INTO price_change_events (user_id, subscription_id, previous_evidence_id, evidence_id, currency, previous_price_cents, current_price_cents, direction, percent_change_bp, annualized_delta_cents, is_material, rule_version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (subscription_id, evidence_id) DO NOTHING',
            [userId, subscriptionId, previousObservation?.evidenceId ?? null, evidence.rows[0].id, priceChange.currency, priceChange.previousPriceCents, priceChange.currentPriceCents, priceChange.direction, priceChange.percentChangeBp, priceChange.annualizedDeltaCents, priceChange.isMaterial, priceChange.ruleVersion],
          )
        }
        await client.query('COMMIT')
        return { created: true, evidence: evidence.rows[0], subscription: await this.getSubscription(userId, subscriptionId) }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async disconnectConnection(userId) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const connections = await client.query('SELECT id FROM source_connections WHERE user_id = $1 AND provider = $2', [userId, 'gmail'])
        const connectionIds = connections.rows.map(({ id }) => id)
        if (connectionIds.length) {
          const subscriptions = await client.query('SELECT DISTINCT se.subscription_id FROM subscription_evidence se JOIN evidence e ON e.id = se.evidence_id JOIN source_messages sm ON sm.id = e.source_message_id WHERE sm.connection_id = ANY($1::uuid[])', [connectionIds])
          const subscriptionIds = subscriptions.rows.map(({ subscription_id: id }) => id)
          if (subscriptionIds.length) {
            await client.query('DELETE FROM field_observations WHERE subscription_id = ANY($1::uuid[])', [subscriptionIds])
            await client.query('DELETE FROM price_observations WHERE subscription_id = ANY($1::uuid[])', [subscriptionIds])
            await client.query('DELETE FROM billing_events WHERE subscription_id = ANY($1::uuid[])', [subscriptionIds])
            await client.query('DELETE FROM subscription_evidence WHERE subscription_id = ANY($1::uuid[])', [subscriptionIds])
            await client.query('DELETE FROM subscriptions WHERE id = ANY($1::uuid[]) AND user_id = $2 AND source = $3', [subscriptionIds, userId, 'Gmail receipt'])
          }
          await client.query('DELETE FROM evidence WHERE source_message_id IN (SELECT id FROM source_messages WHERE connection_id = ANY($1::uuid[]))', [connectionIds])
          await client.query('DELETE FROM source_messages WHERE connection_id = ANY($1::uuid[])', [connectionIds])
          await client.query('DELETE FROM scan_runs WHERE connection_id = ANY($1::uuid[])', [connectionIds])
          await client.query('DELETE FROM field_observations WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM price_observations WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM billing_events WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM subscription_evidence WHERE subscription_id IN (SELECT id FROM subscriptions WHERE user_id = $1 AND source = $2)', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM subscriptions WHERE user_id = $1 AND source = $2', [userId, 'Gmail receipt'])
          await client.query('DELETE FROM source_connections WHERE id = ANY($1::uuid[])', [connectionIds])
        }
        await client.query('COMMIT')
        return { status: 'not_connected', scanStatus: 'idle' }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    // Rejected subscriptions are excluded from the default listing (and, by
    // extension, from any spend total derived from it) but are never deleted
    // - getSubscription (used for direct-by-id lookups) intentionally does
    // not filter by status, so a rejected record remains inspectable.
    async listSubscriptions(userId) { const { rows } = await pool.query("SELECT * FROM subscriptions WHERE user_id = $1 AND status != 'rejected' ORDER BY created_at", [userId]); return Promise.all(rows.map((row) => hydrateSubscription(pool, row))) },
    async getSubscription(userId, id) { const { rows } = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1 AND id = $2', [userId, id]); return hydrateSubscription(pool, rows[0]) },

    // FEATURE-003: material (attention-worthy) price-change events for this
    // user, joined with their subscription for canonicalService/billingCycle.
    // A rejected subscription's events are excluded here, at the source,
    // rather than relying on the caller to filter - same convention as
    // listSubscriptions already excluding rejected rows.
    async listMaterialPriceChangeEvents(userId) {
      const { rows } = await pool.query(
        "SELECT pce.*, s.canonical_service, s.billing_cycle FROM price_change_events pce JOIN subscriptions s ON s.id = pce.subscription_id WHERE pce.user_id = $1 AND pce.is_material = true AND s.status != 'rejected' ORDER BY pce.detected_at DESC",
        [userId],
      )
      return rows.map(priceChangeEventRowMapper)
    },

    // FEATURE-002: user-entered corrections, subscription rejection, and
    // ambiguous-candidate review. Every method below resolves ownership from
    // the caller-supplied `userId` (the internal UUID derived from the
    // session) - never from a client-supplied id on the record itself.
    async applyCorrection(userId, subscriptionId, field, value) {
      if (!CORRECTION_FIELDS.has(field)) throw new Error(`Invalid correction field: ${field}`)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const owned = await client.query('SELECT id FROM subscriptions WHERE user_id = $1 AND id = $2 FOR UPDATE', [userId, subscriptionId])
        if (!owned.rows[0]) { await client.query('ROLLBACK'); return null }
        await client.query('UPDATE subscription_corrections SET superseded_at = now() WHERE subscription_id = $1 AND field = $2 AND superseded_at IS NULL', [subscriptionId, field])
        await client.query('INSERT INTO subscription_corrections (subscription_id, user_id, field, value) VALUES ($1, $2, $3, $4)', [subscriptionId, userId, field, JSON.stringify(value)])
        // `field` is drawn only from CORRECTION_FIELDS above, never from
        // unvalidated caller input, so interpolating it as a column name here
        // is safe.
        await client.query(`UPDATE subscriptions SET ${field} = $1 WHERE id = $2`, [value, subscriptionId])
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
  }
}