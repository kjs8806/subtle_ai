import { createHash, randomBytes } from 'node:crypto'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

// Kept async even though the underlying Map access is synchronous, so
// callers never need to branch on which implementation is active - see
// createPostgresSessionManager below, which is genuinely async (it's a
// database), and is the one actually used whenever PERSISTENCE_PROVIDER is
// postgres. This one remains the memory-persistence/test default.
export const createSessionManager = ({ ttlMs = 8 * 60 * 60 * 1000, now = () => Date.now() } = {}) => {
  const sessions = new Map()
  const issue = async (userId) => {
    const token = randomBytes(32).toString('hex')
    sessions.set(hashToken(token), { userId, createdAt: new Date(now()).toISOString(), expiresAt: now() + ttlMs })
    return token
  }
  const resolve = async (token) => {
    if (!token) return null
    const key = hashToken(token)
    const session = sessions.get(key)
    if (session && session.expiresAt > now()) return session
    sessions.delete(key)
    return null
  }
  const revoke = async (token) => { if (token) sessions.delete(hashToken(token)) }
  // MVP-BETA-004 (#41): this Map is the live session store for memory
  // persistence - Postgres cascades the `sessions` table away for free on
  // account deletion, but that cascade alone would never actually revoke a
  // live token held only in this process's memory. Account deletion needs
  // every session for a user gone, not just the one attached to the
  // request that triggered it - a second concurrent device/tab must not
  // keep working with a deleted account.
  const revokeAllForUser = async (userId) => { for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key) }
  return { issue, resolve, revoke, revokeAllForUser }
}

// MVP-BETA-007 (#44) production incident: a session issued by one Cloud Run
// instance must be resolvable by any other instance the next request lands
// on - Cloud Run is multi-instance and scale-to-zero, with no session
// affinity configured. createSessionManager's in-memory Map above only
// ever worked for a single process; this is the production implementation,
// backed by the `sessions` table (migrations/001_feature_001.sql) instead.
// Same issue/resolve/revoke/revokeAllForUser contract, so server/app.js
// never needs to know which one it was given.
export const createPostgresSessionManager = ({ pool, ttlMs = 8 * 60 * 60 * 1000, now = () => Date.now() } = {}) => {
  const issue = async (userId) => {
    const token = randomBytes(32).toString('hex')
    // Opportunistic cleanup on write rather than a scheduled job - see
    // oauthStateStore.js's identical rationale.
    await pool.query('DELETE FROM sessions WHERE expires_at <= $1', [new Date(now())])
    await pool.query(
      'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [userId, hashToken(token), new Date(now() + ttlMs)],
    )
    return token
  }
  const resolve = async (token) => {
    if (!token) return null
    const key = hashToken(token)
    const { rows } = await pool.query('SELECT user_id, created_at, expires_at FROM sessions WHERE token_hash = $1', [key])
    const row = rows[0]
    if (!row || new Date(row.expires_at).getTime() <= now()) {
      if (row) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [key])
      return null
    }
    return { userId: row.user_id, createdAt: row.created_at, expiresAt: new Date(row.expires_at).getTime() }
  }
  const revoke = async (token) => { if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]) }
  const revokeAllForUser = async (userId) => { await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]) }
  return { issue, resolve, revoke, revokeAllForUser }
}

export const SESSION_COOKIE = 'subtle_session'
