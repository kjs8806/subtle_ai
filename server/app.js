import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { randomUUID } from 'node:crypto'
import { requireQuery } from './api/validation.js'
import { config } from './config/env.js'
import { createFakeGmailProvider } from './gmail/fakeProvider.js'
import { createMemoryRepository } from './persistence/memoryRepository.js'
import { SESSION_COOKIE, createSessionManager } from './security/session.js'
import { createRateLimiter, enforceSameOrigin, securityHeaders } from './security/http.js'
import { parseReceipt } from '../src/services/receiptPipeline.js'

const userId = 'mock-user'

export const buildApp = ({ repository = createMemoryRepository(), provider = createFakeGmailProvider(), sessions = createSessionManager(), production = config.production, publicOrigin = config.publicOrigin, now = () => Date.now() } = {}) => {
  const logger = production ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', '*.refreshToken', '*.body'] } : false
  const app = Fastify({ logger, bodyLimit: 64 * 1024 })
  const oauthStates = new Map()
  app.register(cookie)
  app.decorateRequest('user', null)
  app.addHook('onRequest', securityHeaders)
  app.addHook('onRequest', createRateLimiter())
  app.addHook('onRequest', enforceSameOrigin({ production, origin: publicOrigin }))
  app.addHook('preHandler', async (request) => {
    const session = sessions.resolve(request.cookies[SESSION_COOKIE])
    request.user = session?.userId ? repository.getUser(session.userId) : null
  })
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)
    reply.code(error.statusCode || 500).send({ error: { code: error.code || 'internal_error', message: error.statusCode ? error.message : 'Internal server error' } })
  })
  const requireUser = async (request, reply) => { if (!request.user) return reply.code(401).send({ error: { code: 'unauthenticated', message: 'Authentication required' } }) }

  app.get('/api/v1/health', async () => ({ status: 'ok', provider: config.gmailProvider }))
  app.get('/api/v1/session', async (request) => ({ authenticated: Boolean(request.user), user: request.user }))
  app.get('/api/v1/auth/google/start', async (request, reply) => {
    const state = randomUUID()
    oauthStates.set(state, now() + 10 * 60 * 1000)
    reply.setCookie('subtle_oauth_state', state, { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 600 })
    return provider.createAuthorizationRequest({ state })
  })
  app.get('/api/v1/auth/google/callback', async (request, reply) => {
    requireQuery(request, ['state', 'code'])
    const expiresAt = oauthStates.get(request.query.state)
    oauthStates.delete(request.query.state)
    reply.clearCookie('subtle_oauth_state', { path: '/' })
    if (!request.query.state || request.query.state !== request.cookies.subtle_oauth_state || !expiresAt || expiresAt <= now()) return reply.code(400).send({ error: { code: 'invalid_oauth_state', message: 'Invalid authorization state' } })
    let result
    try {
      result = await provider.exchangeAuthorizationCode({ code: request.query.code })
    } catch {
      return reply.code(502).send({ error: { code: 'authorization_failed', message: 'Gmail authorization could not be completed' } })
    }
    if (result.status !== 'authorized') return reply.code(400).send({ error: { code: result.status, message: 'Authorization was not completed' } })
    const token = sessions.issue(userId)
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 })
    repository.authorizeConnection(userId)
    return { status: 'authorized' }
  })
  app.post('/api/v1/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    sessions.revoke(request.cookies[SESSION_COOKIE])
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { status: 'logged_out' }
  })

  app.get('/api/v1/sources/gmail', { preHandler: requireUser }, async (request) => repository.getConnection(request.user.id))
  app.post('/api/v1/sources/gmail/authorize', { preHandler: requireUser }, async (request) => ({ ...(repository.authorizeConnection(request.user.id)), status: 'connected' }))
  app.get('/api/v1/sources/gmail/callback', { preHandler: requireUser }, async (request) => ({ status: 'connected', query: request.query }))
  app.post('/api/v1/sources/gmail/scan', { preHandler: requireUser }, async (request, reply) => {
    const existingConnection = repository.getConnection(request.user.id)
    if (existingConnection.status === 'reconnect_required') return reply.code(401).send({ error: { code: 'reconnect_required', message: 'Gmail permission expired. Reconnect to continue.' } })
    const scan = repository.beginScan(request.user.id)
    if (!scan) return reply.code(409).send({ error: { code: 'source_not_connected', message: 'Connect Gmail before scanning' } })
    try {
      const messages = await provider.listCandidateMessages()
      if (messages === null) throw new Error('Mock scan failed')
      let found = 0
      let ambiguous = 0
      for (const message of messages) {
        const parsed = parseReceipt(message)
        if (!parsed?.canonicalService || parsed.canonicalService === 'Unknown service' || parsed.amount === null) { ambiguous += 1; continue }
        const result = repository.persistParsedEvidence(request.user.id, parsed)
        if (result.created) found += 1
      }
      const completed = repository.completeScan(request.user.id, scan.id, found)
      return { ...completed, ambiguous }
    } catch (error) {
      request.log.error({ err: error, scanId: scan.id }, 'Gmail scan failed')
      repository.completeScan(request.user.id, scan.id, 0, 'failed')
      if (error.code === 'reconnect_required') {
        repository.expireConnection(request.user.id)
        return reply.code(401).send({ error: { code: 'reconnect_required', message: 'Gmail permission expired. Reconnect to continue.' } })
      }
      return reply.code(502).send({ error: { code: 'scan_failed', message: 'Gmail receipts could not be scanned' } })
    }
  })
  app.post('/api/v1/sources/gmail/disconnect', { preHandler: requireUser }, async (request) => { await provider.revokeConnection(); return repository.disconnectConnection(request.user.id) })
  app.get('/api/v1/subscriptions', { preHandler: requireUser }, async (request) => ({ subscriptions: repository.listSubscriptions(request.user.id) }))
  app.get('/api/v1/subscriptions/:subscriptionId', { preHandler: requireUser }, async (request, reply) => {
    const subscription = repository.getSubscription(request.user.id, request.params.subscriptionId)
    if (!subscription) return reply.code(404).send({ error: { code: 'not_found', message: 'Subscription not found' } })
    return subscription
  })
  return app
}

if (process.argv[1] && process.argv[1].endsWith('/server/app.js')) {
  const app = buildApp()
  app.listen({ port: config.port, host: config.host }).then(() => console.log(`Subtle API listening on http://${config.host}:${config.port}`))
}