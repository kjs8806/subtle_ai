import { randomUUID } from 'node:crypto'

const rowConnection = (row) => row && ({ id: row.id, userId: row.user_id, provider: row.provider, status: row.authorization_state, scanStatus: row.scan_state, lastScanAt: row.last_scan_at })

const hydrateSubscription = async (pool, row) => {
  if (!row) return null
  const [evidence, priceHistory, billingHistory, fieldObservations] = await Promise.all([
    pool.query('SELECT e.id, e.canonical_service AS "canonicalService", e.raw_merchant AS "rawMerchant", e.amount, e.cadence, e.next_renewal AS "nextRenewal", e.confidence, e.provenance, e.excerpt, sm.provider_message_id AS "sourceId", sm.received_at AS "receivedAt" FROM evidence e JOIN subscription_evidence se ON se.evidence_id = e.id JOIN source_messages sm ON sm.id = e.source_message_id WHERE se.subscription_id = $1 ORDER BY e.created_at', [row.id]),
    pool.query('SELECT amount, observed_at AS "observedAt" FROM price_observations WHERE subscription_id = $1 ORDER BY observed_at', [row.id]),
    pool.query('SELECT amount, billed_at AS "billedAt", evidence_id AS "evidenceId" FROM billing_events WHERE subscription_id = $1 ORDER BY billed_at', [row.id]),
    pool.query('SELECT field, value, provenance, confidence, evidence_id AS "evidenceId" FROM field_observations WHERE subscription_id = $1 ORDER BY id', [row.id]),
  ])
  return { id: row.id, userId: row.user_id, canonicalService: row.canonical_service, rawMerchant: row.raw_merchant, plan: row.plan, currentPrice: row.current_price, billingCycle: row.billing_cycle, nextRenewal: row.next_renewal, status: row.status, source: row.source, evidence: evidence.rows, priceHistory: priceHistory.rows, billingHistory: billingHistory.rows, fieldObservations: fieldObservations.rows }
}

export const createPostgresRepository = ({ pool }) => {
  if (!pool) throw new Error('PostgreSQL pool is required')
  return {
    async getUser(id) { const { rows } = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [id]); return rows[0] || null },
    async createUser({ id = randomUUID(), email, name }) { const { rows } = await pool.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3) RETURNING id, email, name', [id, email, name]); return rows[0] },
    async upsertIdentity({ userId, subject, email }) { await pool.query('INSERT INTO auth_identities (user_id, provider, provider_subject, email) VALUES ($1, $2, $3, $4) ON CONFLICT (provider, provider_subject) DO UPDATE SET email = EXCLUDED.email', [userId, 'google', subject, email]) },
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
        if (!candidates.rows[0]) await client.query('INSERT INTO subscriptions (id, user_id, canonical_service, raw_merchant, current_price, billing_cycle, next_renewal, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [subscriptionId, userId, parsed.canonicalService, parsed.rawMerchant, parsed.amount, parsed.cadence, parsed.nextRenewal, 'Gmail receipt'])
        else await client.query('UPDATE subscriptions SET current_price = COALESCE($1, current_price), billing_cycle = COALESCE($2, billing_cycle), next_renewal = COALESCE($3, next_renewal) WHERE id = $4 AND user_id = $5', [parsed.amount, parsed.cadence, parsed.nextRenewal, subscriptionId, userId])
        const evidence = await client.query('INSERT INTO evidence (user_id, source_message_id, canonical_service, raw_merchant, amount, cadence, next_renewal, confidence, provenance, excerpt) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *', [userId, source.rows[0].id, parsed.canonicalService, parsed.rawMerchant, parsed.amount, parsed.cadence, parsed.nextRenewal, parsed.confidence.score, parsed.confidence.state, parsed.excerpt])
        await client.query('INSERT INTO subscription_evidence (subscription_id, evidence_id) VALUES ($1, $2)', [subscriptionId, evidence.rows[0].id])
        await client.query('INSERT INTO billing_events (subscription_id, evidence_id, amount, billed_at) VALUES ($1, $2, $3, $4) ON CONFLICT (subscription_id, evidence_id) DO NOTHING', [subscriptionId, evidence.rows[0].id, parsed.amount, parsed.receivedAt])
        await client.query('INSERT INTO price_observations (subscription_id, evidence_id, amount, observed_at) VALUES ($1, $2, $3, $4)', [subscriptionId, evidence.rows[0].id, parsed.amount, parsed.receivedAt])
        for (const [field, observation] of Object.entries(parsed.fieldObservations || {})) await client.query('INSERT INTO field_observations (subscription_id, field, value, provenance, confidence, evidence_id) VALUES ($1, $2, $3, $4, $5, $6)', [subscriptionId, field, JSON.stringify(observation.value ?? null), observation.provenance, parsed.confidence.score, evidence.rows[0].id])
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
    async listSubscriptions(userId) { const { rows } = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at', [userId]); return Promise.all(rows.map((row) => hydrateSubscription(pool, row))) },
    async getSubscription(userId, id) { const { rows } = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1 AND id = $2', [userId, id]); return hydrateSubscription(pool, rows[0]) },
  }
}