import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { randomUUID } from 'node:crypto'
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

// FEATURE-002: the six correctable fields, keyed by the camelCase name the
// API/UI uses (matching the rest of the subscription payload's casing) and
// mapped to the snake_case field name the repository/DB layer expects (see
// migrations/008_feature_002_corrections.sql's subscription_corrections CHECK).
const CORRECTION_FIELD_MAP = { canonicalService: 'canonical_service', plan: 'plan', currentPrice: 'current_price', currency: 'currency', billingCycle: 'billing_cycle', nextRenewal: 'next_renewal' }
const invalidRequest = (message) => { const error = new Error(message); error.statusCode = 400; error.code = 'invalid_request'; return error }
const validateCorrectionValue = (apiField, value) => {
  if (apiField === 'currentPrice') { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalidRequest('currentPrice must be a non-negative number') }
  else if (apiField === 'currency') { if (value !== 'USD' && value !== 'CAD') throw invalidRequest('currency must be USD or CAD') }
  else if (apiField === 'nextRenewal') { if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalidRequest('nextRenewal must be a valid date string') }
  else { if (typeof value !== 'string' || !value.trim()) throw invalidRequest(`${apiField} must be a non-empty string`) }
}

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
  // Absent, malformed, or tampered ciphertext must never surface as a decrypted
  // value or a thrown crypto error to the caller - both revocation and reconnect
  // logic need a single fail-closed "is there a usable token" check.
  const decryptRefreshToken = (encrypted) => {
    if (!encrypted || !tokenVault) return null
    try {
      return tokenVault.decrypt(encrypted) || null
    } catch {
      return null
    }
  }

  app.get('/api/v1/health', async () => ({ status: 'ok', provider: gmailProvider }))
  app.get('/api/v1/session', async (request) => ({ authenticated: Boolean(request.user), user: request.user }))
  app.get('/api/v1/auth/google/start', async (request, reply) => {
    const state = randomUUID()
    oauthStates.set(state, now() + 10 * 60 * 1000)
    reply.setCookie('subtle_oauth_state', state, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 600 })
    return provider.createAuthorizationRequest({ state })
  })
  // This callback is reached via a real top-level browser navigation (Google's
  // own redirect), never a fetch() the frontend could intercept - so every path
  // through it, success or failure, must redirect back into the app rather than
  // render a bare JSON page the user would be stranded on. The outcome is
  // carried as a query param the frontend reads once on boot and clears.
  const redirectToApp = (reply, params = {}) => reply.redirect(`/${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`)
  app.get('/api/v1/auth/google/callback', async (request, reply) => {
    const { state: queryState, code } = request.query || {}
    const expiresAt = typeof queryState === 'string' ? oauthStates.get(queryState) : undefined
    if (typeof queryState === 'string') oauthStates.delete(queryState)
    reply.clearCookie('subtle_oauth_state', { path: '/' })
    if (typeof queryState !== 'string' || typeof code !== 'string' || !queryState || !code || queryState !== request.cookies.subtle_oauth_state || !expiresAt || expiresAt <= now()) return redirectToApp(reply, { auth_error: 'invalid_oauth_state' })
    // A thrown provider error (e.g. a network failure mid-exchange) must redirect
    // like every other outcome here, never fall through to the generic JSON 500
    // handler - that would be exactly the bare-page problem this route exists to
    // avoid, and could leak upstream error detail into the response besides.
    try {
      const result = await provider.exchangeAuthorizationCode({ code })
      if (result.status !== 'authorized') return redirectToApp(reply, { auth_error: result.status || 'authorization_failed' })
      let authenticatedUserId
      const subject = typeof result.subject === 'string' ? result.subject.trim() : ''
      if (gmailProvider === 'google') {
        // Google's `sub` is the sole authoritative identity for the real provider: no
        // subject means no user, no identity upsert, no session - never fall back to
        // the deterministic mock identity here, that fallback is mock-provider only.
        if (!subject) return redirectToApp(reply, { auth_error: 'missing_subject' })
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
      // Gmail authorization is intentionally a separate, explicit step from
      // application sign-in (see docs/product/features/FEATURE-001.md) - the
      // real gmailProvider === 'google' branch above never auto-connects
      // Gmail here, and the mock provider must not either. Connecting only
      // ever happens via the dedicated POST /sources/gmail/authorize flow.
      return redirectToApp(reply)
    } catch (error) {
      request.log.error(error)
      return redirectToApp(reply, { auth_error: 'authorization_failed' })
    }
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
    const { state: queryState, code } = request.query || {}
    const state = typeof queryState === 'string' ? oauthStates.get(queryState) : undefined
    if (typeof queryState === 'string') oauthStates.delete(queryState)
    reply.clearCookie('subtle_gmail_oauth_state', { path: '/' })
    if (typeof queryState !== 'string' || typeof code !== 'string' || !state || state.purpose !== 'gmail' || state.userId !== request.user.id || state.expiresAt <= now() || queryState !== request.cookies.subtle_gmail_oauth_state) return redirectToApp(reply, { gmail_error: 'invalid_oauth_state' })
    // See the OIDC callback above: a thrown provider error must redirect like
    // every other outcome here, never fall through to the generic JSON 500 handler.
    try {
      const result = await provider.exchangeGmailAuthorizationCode({ code })
      if (result.status !== 'authorized') return redirectToApp(reply, { gmail_error: result.status || 'authorization_failed' })
      // Fail closed: the Gmail-authorized account must be present and must exactly
      // match the signed-in application identity. A gmail.readonly-only access token
      // carries no OIDC claims, so Google's tokeninfo never returns a `sub` for it -
      // there is no way to obtain a stable subject without requesting a broader scope,
      // which would violate the approved exact-scope invariant. Gmail's own profile
      // endpoint (already covered by gmail.readonly) gives the connected mailbox's
      // email address instead, which is compared against the signed-in identity's
      // stored email. A missing match is a security failure, never an acceptable
      // fallback, and this check runs before any refresh-token persistence or
      // connection activation below.
      const gmailEmail = typeof result.email === 'string' ? result.email.trim().toLowerCase() : ''
      const identity = repository.getIdentityForUser ? await repository.getIdentityForUser({ userId: request.user.id, provider: 'google' }) : null
      const identityEmail = typeof identity?.email === 'string' ? identity.email.trim().toLowerCase() : ''
      if (!gmailEmail || !identityEmail || gmailEmail !== identityEmail) return redirectToApp(reply, { gmail_error: 'identity_mismatch' })
      // Google only guarantees a refresh token on first consent; a reconnect may
      // legitimately omit it. Never encrypt an empty string over an existing valid
      // token - that would silently downgrade a working connection to one that can
      // never be refreshed or verifiably revoked. With no new token and no existing
      // usable one, the connection must not be marked connected at all.
      const newRefreshToken = result.refresh_token || result.refreshToken || ''
      let encryptedToken
      if (newRefreshToken) {
        encryptedToken = tokenVault ? tokenVault.encrypt(newRefreshToken) : null
      } else {
        const existingEncryptedToken = repository.getEncryptedRefreshToken ? await repository.getEncryptedRefreshToken(request.user.id) : null
        if (!decryptRefreshToken(existingEncryptedToken)) return redirectToApp(reply, { gmail_error: 'missing_refresh_token' })
        encryptedToken = existingEncryptedToken
      }
      await repository.authorizeConnection(request.user.id, encryptedToken)
      return redirectToApp(reply)
    } catch (error) {
      request.log.error(error)
      return redirectToApp(reply, { gmail_error: 'authorization_failed' })
    }
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
        const { classification, evidence, candidate } = parseReceipt(message)
        if (classification === 'ambiguous') {
          // FEATURE-002: an ambiguous message is never auto-imported, but it is
          // no longer silently discarded - it is persisted as a pending
          // candidate for the user to review, confirm, or reject. It never
          // counts toward `found` and never appears as an active subscription.
          if (candidate && repository.persistCandidate) await repository.persistCandidate(request.user.id, candidate)
          ambiguous += 1
          continue
        }
        if (classification !== 'subscription') continue // not_receipt or one_time: never persisted
        const result = await repository.persistParsedEvidence(request.user.id, evidence)
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
    const refreshToken = decryptRefreshToken(encryptedToken)
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

  // FEATURE-002: corrections, rejection, and ambiguous-candidate review.
  // Every route below is scoped to request.user.id (set by the session
  // preHandler above) - never to a client-supplied id - and looks the target
  // record up under that id first, returning 404 for anything not owned by
  // the caller, matching the existing GET /subscriptions/:id convention.
  app.patch('/api/v1/subscriptions/:subscriptionId', { preHandler: requireUser }, async (request, reply) => {
    const { field, value } = request.body || {}
    if (typeof field !== 'string' || !(field in CORRECTION_FIELD_MAP)) return reply.code(400).send({ error: { code: 'invalid_request', message: 'field must be one of canonicalService, plan, currentPrice, currency, billingCycle, nextRenewal' } })
    if (value === undefined) return reply.code(400).send({ error: { code: 'invalid_request', message: 'value is required' } })
    validateCorrectionValue(field, value)
    const result = await repository.applyCorrection(request.user.id, request.params.subscriptionId, CORRECTION_FIELD_MAP[field], value)
    if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Subscription not found' } })
    return result.subscription
  })
  app.post('/api/v1/subscriptions/:subscriptionId/reject', { preHandler: requireUser }, async (request, reply) => {
    const subscription = await repository.rejectSubscription(request.user.id, request.params.subscriptionId)
    if (!subscription) return reply.code(404).send({ error: { code: 'not_found', message: 'Subscription not found' } })
    return subscription
  })
  app.get('/api/v1/subscriptions/candidates', { preHandler: requireUser }, async (request) => ({ candidates: await repository.listCandidates(request.user.id) }))
  app.post('/api/v1/subscriptions/candidates/:candidateId/confirm', { preHandler: requireUser }, async (request, reply) => {
    const overrides = request.body || {}
    const result = await repository.confirmCandidate(request.user.id, request.params.candidateId, overrides)
    if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Candidate not found' } })
    if (result.error === 'invalid_state') return reply.code(409).send({ error: { code: 'invalid_candidate_state', message: 'Candidate is not pending' } })
    return result.subscription
  })
  app.post('/api/v1/subscriptions/candidates/:candidateId/reject', { preHandler: requireUser }, async (request, reply) => {
    const result = await repository.rejectCandidate(request.user.id, request.params.candidateId)
    if (!result) return reply.code(404).send({ error: { code: 'not_found', message: 'Candidate not found' } })
    if (result.error === 'invalid_state') return reply.code(409).send({ error: { code: 'invalid_candidate_state', message: 'Candidate is already confirmed' } })
    return { status: 'rejected' }
  })

  // FEATURE-003: price-change/renewal intelligence, unified with FEATURE-002's
  // ambiguous-candidate review into one Worth-your-attention list. itemKey
  // (e.g. "price-change:<subId>:<prev>:<curr>:<currency>" or
  // "renewal:<subId>:<date>") is opaque to the API - it's whatever
  // buildAttentionItems() assigned as that item's id, round-tripped through
  // the client for dismissal, URL-encoded since it contains colons.
  app.get('/api/v1/attention', { preHandler: requireUser }, async (request) => ({ items: await repository.listAttentionItems(request.user.id) }))
  app.post('/api/v1/attention/:itemKey/dismiss', { preHandler: requireUser }, async (request) => repository.dismissAttentionItem(request.user.id, decodeURIComponent(request.params.itemKey)))
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
