import { createHash, randomBytes } from 'node:crypto'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export const createSessionManager = ({ ttlMs = 8 * 60 * 60 * 1000, now = () => Date.now() } = {}) => {
  const sessions = new Map()
  const issue = (userId) => {
    const token = randomBytes(32).toString('hex')
    sessions.set(hashToken(token), { userId, createdAt: new Date(now()).toISOString(), expiresAt: now() + ttlMs })
    return token
  }
  const resolve = (token) => {
    if (!token) return null
    const key = hashToken(token)
    const session = sessions.get(key)
    if (session && session.expiresAt > now()) return session
    sessions.delete(key)
    return null
  }
  const revoke = (token) => { if (token) sessions.delete(hashToken(token)) }
  // MVP-BETA-004 (#41): this Map is the live session store regardless of
  // PERSISTENCE_PROVIDER - the `sessions` DB table nothing here ever reads
  // or writes (Postgres cascades it away for free on account deletion, but
  // that cascade alone would never actually revoke a live token). Account
  // deletion needs every session for a user gone, not just the one attached
  // to the request that triggered it - a second concurrent device/tab must
  // not keep working with a deleted account.
  const revokeAllForUser = (userId) => { for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key) }
  return { issue, resolve, revoke, revokeAllForUser }
}

export const SESSION_COOKIE = 'subtle_session'
