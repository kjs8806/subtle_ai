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
  return { issue, resolve, revoke }
}

export const SESSION_COOKIE = 'subtle_session'
