import { createHash, randomBytes } from 'node:crypto'

const hashToken = (token) => createHash('sha256').update(token).digest('hex')

export const createSessionManager = () => {
  const sessions = new Map()
  const issue = (userId) => {
    const token = randomBytes(32).toString('hex')
    sessions.set(hashToken(token), { userId, createdAt: new Date().toISOString() })
    return token
  }
  const resolve = (token) => token ? sessions.get(hashToken(token)) || null : null
  const revoke = (token) => { if (token) sessions.delete(hashToken(token)) }
  return { issue, resolve, revoke }
}

export const SESSION_COOKIE = 'subtle_session'
