import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { randomUUID } from 'node:crypto'
import { requireQuery } from './api/validation.js'
import { config } from './config/env.js'
import { validateConfig } from './config/env.js'
import { createGoogleProvider } from './auth/googleProvider.js'
import { createFakeGmailProvider } from './gmail/fakeProvider.js'
import { createMemoryRepository } from './persistence/memoryRepository.js'
import { SESSION_COOKIE, createSessionManager } from './security/session.js'
import { createTokenVault } from './security/tokenVault.js'
import { createRateLimiter, enforceSameOrigin, securityHeaders } from './security/http.js'
import { parseReceipt } from '../src/services/receiptPipeline.js'
import { createRuntime } from './bootstrap.js'

const userId = 'mock-user'

export const buildApp = ({ repository = createMemoryRepository(), provider = config.gmailProvider === 'google' ? createGoogleProvider({ clientId: config.googleClientId, clientSecret: config.googleClientSecret, oidcRedirectUri: config.googleOidcRedirectUri, gmailRedirectUri: config.googleGmailRedirectUri }) : createFakeGmailProvider(), gmailProvider = config.gmailProvider, sessions = createSessionManager(), tokenVault = config.tokenEncryptionKey ? createTokenVault({ secret: config.tokenEncryptionKey }) : null, production = config.production, publicOrigin = config.publicOrigin, now = () => Date.now() } = {}) => {
  // Real Google auth is always served over HTTPS (Codespaces' forwarded-port proxy
  // included), regardless of NODE_ENV, so cookie/origin hardening must not be gated
  // solely on the NODE_ENV=production flag - GMAIL_PROVIDER=google activates it too.
  const secure = production || gmailProvider === 'google'
  const logger = production ? { redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', '*.refreshToken', '*.ciphertext', '*.body'] } : false
  const app = Fastify({ logger, bodyLimit: 64 * 1024 })
  const oauthStates = new Map()
  app.register(cookie)
  app.decorateRequest('user', null)
  app.addHook('onRequest', securityHeaders)
  app.addHook('onRequest', createRateLimiter())
  app.addHook('onRequest', enforceSameOrigin({ enforce: secure, origin: publicOrigin }))
  app.addHook('preHandler', async (request) => {
    const session = sessions.resolve(request.cookies[SESSION_COOKIE])
    request.user = session?.userId ? await repository.getUser(session.userId) : null
  })
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error)
    reply.code(error.statusCode || 500).send({ error: { code: error.code || 'internal_error', message: error.statusCode ? error.message : 'Internal server error' } })
  })
  const requireUser = async (request, reply) => { if (!request.user) return reply.code(401).send({ error: { code: 'unauthenticated', message: 'Authentication required' } }) }

  app.get('/api/v1/health', async () => ({ status: 'ok', provider: gmailProvider }))
  app.get('/api/v1/session', async (request) => ({ authenticated: Boolean(request.user), user: request.user }))
  app.get('/api/v1/auth/google/start', async (request, reply) => {
    const state = randomUUID()
    oauthStates.set(state, now() + 10 * 60 * 1000)
    reply.setCookie('subtle_oauth_state', state, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 600 })
    return provider.createAuthorizationRequest({ state })
  })
  app.get('/api/v1/auth/google/callback', async (request, reply) => {
    requireQuery(request, ['state', 'code'])
    const expiresAt = oauthStates.get(request.query.state)
    oauthStates.delete(request.query.state)
    reply.clearCookie('subtle_oauth_state', { path: '/' })
    if (!request.query.state || request.query.state !== request.cookies.subtle_oauth_state || !expiresAt || expiresAt <= now()) return reply.code(400).send({ error: { code: 'invalid_oauth_state', message: 'Invalid authorization state' } })
    const result = await provider.exchangeAuthorizationCode({ code: request.query.code })
    if (result.status !== 'authorized') return reply.code(400).send({ error: { code: result.status, message: 'Authorization was not completed' } })
    let authenticatedUserId
    const subject = typeof result.subject === 'string' ? result.subject.trim() : ''
    if (gmailProvider === 'google') {
      // Google's `sub` is the sole authoritative identity for the real provider: no
      // subject means no user, no identity upsert, no session - never fall back to
      // the deterministic mock identity here, that fallback is mock-provider only.
      if (!subject) return reply.code(401).send({ error: { code: 'missing_subject', message: 'Google sign-in did not return a subject identifier' } })
      const user = await repository.resolveOrCreateIdentity({ provider: 'google', subject, email: result.email, name: result.name })
      authenticatedUserId = user.id
    } else if (subject && repository.resolveOrCreateIdentity) {
      const user = await repository.resolveOrCreateIdentity({ provider: 'google', subject, email: result.email, name: result.name })
      authenticatedUserId = user.id
    } else {
      authenticatedUserId = userId
    }
    const token = sessions.issue(authenticatedUserId)
    reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 })
    if (gmailProvider === 'mock') await repository.authorizeConnection(authenticatedUserId, tokenVault?.encrypt(result.refreshToken || '') || null)
    return { status: 'authorized' }
  })
  app.post('/api/v1/auth/logout', { preHandler: requireUser }, async (request, reply) => {
    sessions.revoke(request.cookies[SESSION_COOKIE])
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { status: 'logged_out' }
  })

  app.get('/api/v1/sources/gmail', { preHandler: requireUser }, async (request) => repository.getConnection(request.user.id))
  app.post('/api/v1/sources/gmail/authorize', { preHandler: requireUser }, async (request, reply) => {
    const state = randomUUID()
    oauthStates.set(state, { expiresAt: now() + 10 * 60 * 1000, userId: request.user.id, purpose: 'gmail' })
    reply.setCookie('subtle_gmail_oauth_state', state, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 600 })
    if (gmailProvider === 'mock') return { ...(await repository.authorizeConnection(request.user.id)), status: 'connected' }
    return provider.createGmailAuthorizationRequest({ state })
  })
  app.get('/api/v1/sources/gmail/callback', { preHandler: requireUser }, async (request, reply) => {
    requireQuery(request, ['state', 'code'])
    const state = oauthStates.get(request.query.state)
    oauthStates.delete(request.query.state)
    reply.clearCookie('subtle_gmail_oauth_state', { path: '/' })
    if (!state || state.purpose !== 'gmail' || state.userId !== request.user.id || state.expiresAt <= now() || request.query.state !== request.cookies.subtle_gmail_oauth_state) return reply.code(400).send({ error: { code: 'invalid_oauth_state', message: 'Invalid authorization state' } })
    const result = await provider.exchangeGmailAuthorizationCode({ code: request.query.code })
    if (result.status !== 'authorized') return reply.code(400).send({ error: { code: result.status, message: 'Authorization was not completed' } })
    // Fail closed: the Gmail-authorized Google subject must be present and must
    // exactly equal the signed-in application identity's Google subject. A missing
    // subject is a security failure, never an acceptable fallback, and this check
    // runs before any refresh-token persistence or connection activation below.
    const gmailSubject = typeof result.subject === 'string' ? result.subject.trim() : ''
    const identity = repository.getIdentityForUser ? await repository.getIdentityForUser({ userId: request.user.id, provider: 'google' }) : null
    if (!gmailSubject || !identity || gmailSubject !== identity.subject) return reply.code(409).send({ error: { code: 'identity_mismatch', message: 'The Gmail account does not match the signed-in account' } })
    return { ...(await repository.authorizeConnection(request.user.id, tokenVault?.encrypt(result.refresh_token || result.refreshToken || '') || null)), status: 'connected' }
  })
  app.post('/api/v1/sources/gmail/scan', { preHandler: requireUser }, async (request, reply) => {
    const scan = await repository.beginScan(request.user.id)
    if (!scan) return reply.code(409).send({ error: { code: 'source_not_connected', message: 'Connect Gmail before scanning' } })
    if (scan.conflict) return reply.code(409).send({ error: { code: 'scan_already_running', message: 'A scan is already running for this connection' } })
    try {
      const encryptedToken = repository.getEncryptedRefreshToken ? await repository.getEncryptedRefreshToken(request.user.id) : null
      const refreshToken = encryptedToken && tokenVault ? tokenVault.decrypt(encryptedToken) : null
      const access = provider.refreshAccessToken ? await provider.refreshAccessToken(refreshToken) : null
      const messages = await provider.listCandidateMessages({ accessToken: access?.accessToken, refreshToken })
      if (messages === null) throw new Error('Mock scan failed')
      let found = 0
      let ambiguous = 0
      for (const message of messages) {
        const parsed = parseReceipt(message)
        if (!parsed?.canonicalService || parsed.canonicalService === 'Unknown service' || parsed.amount === null) { ambiguous += 1; continue }
        const result = await repository.persistParsedEvidence(request.user.id, parsed)
        if (result.created) found += 1
      }
      const completed = await repository.completeScan(request.user.id, scan.id, found)
      return { ...completed, ambiguous }
    } catch (error) {
      request.log.error({ err: error, scanId: scan.id }, 'Gmail scan failed')
      await repository.completeScan(request.user.id, scan.id, 0, 'failed')
      return reply.code(502).send({ error: { code: 'scan_failed', message: 'Gmail receipts could not be scanned' } })
    }
  })
  app.post('/api/v1/sources/gmail/disconnect', { preHandler: requireUser }, async (request, reply) => {
    // Ordering matters: revoke with Google first, verify the provider actually
    // confirmed revocation, and only then purge locally. A failed or unverifiable
    // revocation must never be reported as disconnected, and must leave the
    // encrypted token in place so a retry can revoke it.
    const encryptedToken = repository.getEncryptedRefreshToken ? await repository.getEncryptedRefreshToken(request.user.id) : null
    const refreshToken = encryptedToken && tokenVault ? tokenVault.decrypt(encryptedToken) : null
    let revocation
    try {
      revocation = await provider.revokeConnection({ token: refreshToken })
    } catch (error) {
      request.log.error({ err: error }, 'Gmail token revocation failed')
      return reply.code(502).send({ error: { code: 'revocation_failed', message: 'Gmail could not be disconnected. Please try again.' } })
    }
    if (revocation?.status !== 'disconnected') return reply.code(502).send({ error: { code: 'revocation_failed', message: 'Gmail could not be disconnected. Please try again.' } })
    return repository.disconnectConnection(request.user.id)
  })
  app.get('/api/v1/subscriptions', { preHandler: requireUser }, async (request) => ({ subscriptions: await repository.listSubscriptions(request.user.id) }))
  app.get('/api/v1/subscriptions/:subscriptionId', { preHandler: requireUser }, async (request, reply) => {
    const subscription = await repository.getSubscription(request.user.id, request.params.subscriptionId)
    if (!subscription) return reply.code(404).send({ error: { code: 'not_found', message: 'Subscription not found' } })
    return subscription
  })
  return app
}

if (process.argv[1] && process.argv[1].endsWith('/server/app.js')) {
  let runtime
  try {
    runtime = await createRuntime(buildApp)
  } catch (error) {
    console.error(`Subtle API failed to start: ${error.message}`)
    process.exit(1)
  }
  const { app, close } = runtime
  await app.listen({ port: config.port, host: config.host })
  console.log(`Subtle API listening on http://${config.host}:${config.port}`)
  const shutdown = async () => {
    await close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
