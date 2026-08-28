// MVP-BETA-007 (#44) production incident: OAuth state (the short-lived
// token proving a callback belongs to the /start request that issued it)
// must survive being read back by a different Cloud Run instance than the
// one that created it - Cloud Run is multi-instance and scale-to-zero, and
// nothing about the OAuth round trip (the user authenticating with Google
// in between) guarantees the same instance handles both legs. An in-memory
// store only works for a single process; see createPostgresOAuthStateStore
// for the durable, shared-across-instances implementation actually used in
// production. Both expose the same async create()/consume() contract so
// callers (server/app.js) never branch on which one is active.

export const createOAuthStateStore = ({ now = () => Date.now() } = {}) => {
  const states = new Map()
  const create = async (state, { expiresAt, userId = null, purpose = null } = {}) => {
    states.set(state, { expiresAt, userId, purpose })
  }
  // Atomically reads and removes a state in one call - a state must never
  // be usable twice, and folding the expiry check in here means every
  // caller gets "valid, unexpired record, or null" instead of re-deriving
  // that from a raw expiresAt themselves.
  const consume = async (state) => {
    const record = states.get(state)
    states.delete(state)
    if (!record || record.expiresAt <= now()) return null
    return record
  }
  return { create, consume }
}

export const createPostgresOAuthStateStore = ({ pool, now = () => Date.now() } = {}) => {
  const create = async (state, { expiresAt, userId = null, purpose = null } = {}) => {
    // Opportunistic cleanup on write, not a scheduled job - this table's
    // rows live at most ten minutes (server/app.js's OAuth start routes),
    // so bounding it here keeps it from growing unboundedly without
    // needing separate cron infrastructure for a beta this small.
    await pool.query('DELETE FROM oauth_states WHERE expires_at <= $1', [new Date(now())])
    await pool.query(
      'INSERT INTO oauth_states (state, expires_at, user_id, purpose) VALUES ($1, $2, $3, $4)',
      [state, new Date(expiresAt), userId, purpose],
    )
  }
  const consume = async (state) => {
    const { rows } = await pool.query('DELETE FROM oauth_states WHERE state = $1 RETURNING expires_at, user_id, purpose', [state])
    const row = rows[0]
    if (!row || new Date(row.expires_at).getTime() <= now()) return null
    return { expiresAt: new Date(row.expires_at).getTime(), userId: row.user_id, purpose: row.purpose }
  }
  return { create, consume }
}
