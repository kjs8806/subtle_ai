import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { config } from './config/env.js'
import { validateConfig } from './config/env.js'
import { createGoogleProvider } from './auth/googleProvider.js'
import { createFakeGmailProvider } from './gmail/fakeProvider.js'
import { createMemoryRepository } from './persistence/memoryRepository.js'
import { SESSION_COOKIE, createSessionManager } from './security/session.js'
import { createOAuthStateStore } from './security/oauthStateStore.js'
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

// SEC-041-01 (Security Manager remediation on #41/PR #51): a small, bounded,
// immediate in-process retry for operations that must not be treated as
// having "failed" over one transient blip - specifically
// repository.markGmailRevoked, called only after Google has already
// confirmed revocation, where a failure means the fact isn't durably
// recorded yet, not that anything is actually wrong with the connection.
// Retrying locally, inside the same request, absorbs the common transient
// case without ever depending on a second call to Google - see the Gmail
// disconnect route below for the full rationale.
const withRetries = async (fn, attempts = 3, delayMs = 25) => {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await fn() } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw lastError
}

export const buildApp = ({ repository = createMemoryRepository(), provider = config.gmailProvider === 'google' ? createGoogleProvider({ clientId: config.googleClientId, clientSecret: config.googleClientSecret, oidcRedirectUri: config.googleOidcRedirectUri, gmailRedirectUri: config.googleGmailRedirectUri }) : createFakeGmailProvider(), gmailProvider = config.gmailProvider, sessions = createSessionManager(), oauthStates = createOAuthStateStore(), tokenVault = config.tokenEncryptionKey ? createTokenVault({ secret: config.tokenEncryptionKey }) : null, production = config.production, publicOrigin = config.publicOrigin, now = () => Date.now(), pool = null } = {}) => {
  // Real Google auth is always served over HTTPS (Codespaces' forwarded-port proxy
  // included), regardless of NODE_ENV, so cookie/origin hardening must not be gated
  // solely on the NODE_ENV=production flag - GMAIL_PROVIDER=google activates it too.
  const secure = production || gmailProvider === 'google'
  // Cloud Run's structured-logging ingestion only promotes a log entry's
  // severity (and therefore `severity>=ERROR`-style log filters) from a
  // top-level `severity` field with one of its own enum values - it does not
  // understand pino's default numeric `level` (e.g. 50 for error), so
  // without this every error logged here was silently landing as `DEFAULT`
  // severity in Cloud Logging, invisible to any severity-filtered query.
  const PINO_LEVEL_TO_GCP_SEVERITY = { trace: 'DEBUG', debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR', fatal: 'CRITICAL' }
  const logger = production ? {
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie', '*.refreshToken', '*.ciphertext', '*.body'],
    messageKey: 'message',
    formatters: { level: (label) => ({ severity: PINO_LEVEL_TO_GCP_SEVERITY[label] || 'DEFAULT' }) },
  } : false
  const app = Fastify({ logger, bodyLimit: 64 * 1024 })
  app.register(cookie)
  // MVP-BETA-007 (#44): approved architecture is ONE Cloud Run container
  // serving both the built Vite PWA and the /api/v1 API same-origin (no
  // CORS/session-domain complexity). `dist/` is a gitignored build artifact
  // (see .gitignore) that doesn't exist until `npm run build` has run - it's
  // absent during `npm test` in CI (which runs before the build step) and in
  // any test that constructs the app directly, so this only registers static
  // serving when the directory is actually present, never a hard dependency
  // for the API itself. The production container image always runs `vite
  // build` before starting the server (see Dockerfile), so `dist/` is
  // guaranteed to exist there.
  const distDir = fileURLToPath(new URL('../dist', import.meta.url))
  const serveStaticApp = existsSync(distDir)
  if (serveStaticApp) {
    app.register(fastifyStatic, { root: distDir, wildcard: true })
    // Client-side (hash-based) routing means a path like /subscriptions/xyz
    // has no matching static file - fastifyStatic's wildcard route 404s for
    // that (correctly - it's not a real asset), which lands here. Any GET
    // that isn't under /api/v1 and isn't a real static file falls back to
    // index.html so the SPA router can take over; /api/v1 requests that
    // genuinely don't match a route keep the normal JSON 404 they already get.
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/v1/')) return reply.sendFile('index.html')
      return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } })
    })
  }
  app.decorateRequest('user', null)
  app.addHook('onRequest', securityHeaders)
  app.addHook('onRequest', createRateLimiter())
  app.addHook('onRequest', enforceSameOrigin({ enforce: secure, origin: publicOrigin }))
  app.addHook('preHandler', async (request) => {
    const session = await sessions.resolve(request.cookies[SESSION_COOKIE])
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

  // MVP-BETA-007 (#44): liveness only - "the process is running and can
  // answer HTTP requests." Never exposes which provider/persistence backend
  // is configured (that was previously leaked here as `provider`) - that's
  // operational configuration, not something an unauthenticated caller needs
  // to learn. Cloud Run (or any load balancer) can hit this cheaply and
  // often without ever touching the database.
  app.get('/api/v1/health', async () => ({ status: 'ok' }))
  // Readiness - "the process is running AND its critical dependencies are
  // reachable." For a postgres-backed runtime that means the pool can
  // actually reach the database right now; for memory persistence there is
  // no external dependency, so readiness reduces to liveness. A failure here
  // is real operational signal (Cloud Run should stop routing traffic to
  // this instance) but must never leak *why* - no connection string, no
  // driver error message, no stack trace - only a generic unavailable
  // response to the caller, with the real error logged server-side only.
  app.get('/api/v1/health/ready', async (request, reply) => {
    if (!pool) return { status: 'ok' }
    try {
      await pool.query('SELECT 1')
      return { status: 'ok' }
    } catch (error) {
      request.log.error({ err: error }, 'Readiness check failed: database unreachable')
      return reply.code(503).send({ status: 'unavailable' })
    }
  })
  app.get('/api/v1/session', async (request) => ({ authenticated: Boolean(request.user), user: request.user }))
  app.get('/api/v1/auth/google/start', async (request, reply) => {
    const state = randomUUID()
    await oauthStates.create(state, { expiresAt: now() + 10 * 60 * 1000 })
    reply.setCookie('subtle_oauth_state', state, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 600 })
    return provider.createAuthorizationRequest({ state })
  })
  // This callback is reached via a real top-level browser navigation (Google's
  // own redirect), never a fetch() the frontend could intercept - so every path
  // through it, success or failure, must redirect back into the app rather than
  // render a bare JSON page the user would be stranded on. The outcome is
  // carried as a query param the frontend reads once on boot and clears.
  const redirectToApp = (reply, params = {}, hash = '') => reply.redirect(`/${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}${hash}`)
  app.get('/api/v1/auth/google/callback', async (request, reply) => {
    const { state: queryState, code } = request.query || {}
    reply.clearCookie('subtle_oauth_state', { path: '/' })
    // A thrown error here - the OAuth state lookup (a real Postgres query,
    // see oauthStateStore.js) or the provider exchange below (e.g. a network
    // failure mid-exchange) - must redirect like every other outcome on this
    // route, never fall through to the generic JSON 500 handler. That would
    // be exactly the bare-page problem this route exists to avoid, and could
    // leak upstream error detail into the response besides. The state lookup
    // therefore lives inside this try, not before it.
    try {
      const stateRecord = typeof queryState === 'string' ? await oauthStates.consume(queryState) : null
      if (typeof queryState !== 'string' || typeof code !== 'string' || !queryState || !code || queryState !== request.cookies.subtle_oauth_state || !stateRecord) return redirectToApp(reply, { auth_error: 'invalid_oauth_state' })
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
      const token = await sessions.issue(authenticatedUserId)
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
    await sessions.revoke(request.cookies[SESSION_COOKIE])
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { status: 'logged_out' }
  })

  app.get('/api/v1/sources/gmail', { preHandler: requireUser }, async (request) => repository.getConnection(request.user.id))
  app.post('/api/v1/sources/gmail/authorize', { preHandler: requireUser }, async (request, reply) => {
    const state = randomUUID()
    await oauthStates.create(state, { expiresAt: now() + 10 * 60 * 1000, userId: request.user.id, purpose: 'gmail' })
    reply.setCookie('subtle_gmail_oauth_state', state, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 600 })
    if (gmailProvider === 'mock') return { ...(await repository.authorizeConnection(request.user.id)), status: 'connected' }
    return provider.createGmailAuthorizationRequest({ state })
  })
  app.get('/api/v1/sources/gmail/callback', { preHandler: requireUser }, async (request, reply) => {
    // Every outcome of this callback - success or failure - is Gmail-specific
    // and belongs on the Sources page: success lands the user on its existing
    // "Connected - ready to scan" state (the next-step guidance FEATURE-039
    // A5 requires) instead of stranding them on Overview with no cue that
    // anything happened, and a failure surfaces via the Sources page's own
    // gmail-message slot (renderRoute only reads gmailError there) instead of
    // being silently dropped when the user lands on '/' with nothing checking
    // for it.
    const redirectToSources = (params = {}) => redirectToApp(reply, params, '#/sources')
    const { state: queryState, code } = request.query || {}
    reply.clearCookie('subtle_gmail_oauth_state', { path: '/' })
    // See the OIDC callback above: a thrown error - including the OAuth
    // state lookup itself, a real Postgres query - must redirect like every
    // other outcome here, never fall through to the generic JSON 500
    // handler, so the lookup lives inside this try.
    try {
      const state = typeof queryState === 'string' ? await oauthStates.consume(queryState) : null
      if (typeof queryState !== 'string' || typeof code !== 'string' || !state || state.purpose !== 'gmail' || state.userId !== request.user.id || queryState !== request.cookies.subtle_gmail_oauth_state) return redirectToSources({ gmail_error: 'invalid_oauth_state' })
      const result = await provider.exchangeGmailAuthorizationCode({ code })
      if (result.status !== 'authorized') return redirectToSources({ gmail_error: result.status || 'authorization_failed' })
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
      if (!gmailEmail || !identityEmail || gmailEmail !== identityEmail) return redirectToSources({ gmail_error: 'identity_mismatch' })
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
        if (!decryptRefreshToken(existingEncryptedToken)) return redirectToSources({ gmail_error: 'missing_refresh_token' })
        encryptedToken = existingEncryptedToken
      }
      await repository.authorizeConnection(request.user.id, encryptedToken)
      return redirectToSources()
    } catch (error) {
      request.log.error(error)
      return redirectToSources({ gmail_error: 'authorization_failed' })
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
  // MVP-BETA-004 (#41, Tech Lead remediation on PR #51; extended by
  // SEC-041-01, Security Manager remediation on PR #51): a four-state
  // durable machine over source_connections.authorization_state -
  // 'connected' (not attempted) -> 'revoke_requested' (attempt in
  // progress/outcome uncertain) -> 'revoked_pending_purge' (revocation
  // confirmed, local purge pending) -> row deleted (purge completed, see
  // disconnectConnection). Ordering matters at every step: record intent
  // with Google first, verify the provider actually confirmed revocation,
  // persist that confirmation, and only then purge locally. A failed or
  // unverifiable revocation must never be reported as disconnected, and
  // must leave the encrypted token in place so a retry can revoke it
  // (CASE B).
  //
  // Gap 1 (Tech Lead remediation, PR #51): if remote revocation succeeds but
  // the local purge transaction then fails (a transient DB error, not a
  // security failure), the token is already dead at Google - a naive retry
  // that calls provider.revokeConnection() again would be revoking an
  // already-revoked token, which a real provider can legitimately reject as
  // invalid, permanently blocking the user from ever finishing disconnect.
  // Once revocation is confirmed, repository.markGmailRevoked persists that
  // fact (and clears the now-dead token) *before* attempting the purge, so a
  // retry - detected by the connection already being in
  // 'revoked_pending_purge' - skips straight to retrying the purge without
  // depending on a second successful provider call at all (CASE A).
  //
  // Gap 2 (SEC-041-01): Gap 1's fix assumed repository.markGmailRevoked's own
  // write always succeeds once called. It can fail too (the same class of
  // transient DB error, now landing between "Google confirmed revocation"
  // and "we recorded that fact"). Before this fix, that left the connection
  // silently back at 'connected' - looking exactly like a healthy,
  // still-scannable connection, with a token that was actually already dead
  // at Google - and a retry would call provider.revokeConnection() again
  // from scratch, which a real provider is not guaranteed to accept safely
  // twice. Two changes close this: (1) repository.beginGmailDisconnect
  // durably records 'revoke_requested' *before* Google is ever contacted, so
  // scanning is blocked (repository.beginScan requires authorization_state
  // = 'connected') and the connection can never look "normal" again from
  // this point forward, whatever crashes or fails next; (2) the write that
  // records confirmed revocation is retried a bounded number of times
  // in-process, immediately, so a single transient blip - the common case -
  // is absorbed without any second call to Google at all. If those retries
  // are exhausted (or the process crashes outright), the connection simply
  // stays at 'revoke_requested': still safe, still scan-blocked, still
  // recoverable on the next request via CASE A's existing retry path, which
  // is fine to call provider.revokeConnection() again since revoking an
  // already-revoked token is specifically designed to be a safe no-op, not a
  // rejected operation.
  //
  // A *definitive* negative answer from the provider - a completed exchange
  // with Google that came back rejected (revocation_failed), or no usable
  // token to send at all - is different from an *ambiguous* one. Only a
  // definitive answer lets us say with certainty that revocation never
  // happened, so only then does repository.cancelGmailDisconnect revert
  // beginGmailDisconnect's marker back to 'connected', preserving CASE B's
  // pre-existing, unrelated guarantee: a genuine revocation failure never
  // purges data and leaves the connection fully usable for a retry.
  //
  // Gap 3 (SEC-041-02): a network/transport failure - the provider itself
  // throwing, or returning 'revocation_ambiguous' (see
  // server/auth/googleProvider.js's revokeConnection) - is NOT a definitive
  // answer, even though it also isn't 'disconnected'. The request may never
  // have reached Google, or it may have been processed successfully with
  // the confirmation lost in transit - we cannot tell which. Treating this
  // the same as a definitive rejection (reverting to 'connected' and
  // allowing scanning again) risked exactly the scenario this whole state
  // machine exists to prevent: a connection that looks healthy and
  // still-usable while its token may already be dead at Google. An
  // ambiguous outcome therefore never calls cancelGmailDisconnect - the
  // connection stays at 'revoke_requested' (scan-blocked, token retained)
  // until a definitive answer, in either direction, is actually obtained.
  app.post('/api/v1/sources/gmail/disconnect', { preHandler: requireUser }, async (request, reply) => {
    // Best-effort revert of beginGmailDisconnect's marker on a *definitive*
    // provider failure - repository methods here may be sync (memory) or
    // async (Postgres), so this always goes through try/catch rather than
    // promise chaining, and a failure to revert is logged but never allowed
    // to mask the real 502 being returned to the client.
    const tryCancelGmailDisconnect = async () => {
      try { await repository.cancelGmailDisconnect(request.user.id) }
      catch (cancelError) { request.log.error({ err: cancelError }, 'Failed to revert Gmail disconnect request marker') }
    }
    const connection = await repository.getConnection(request.user.id)
    if (connection.status !== 'revoked_pending_purge') {
      try {
        await repository.beginGmailDisconnect(request.user.id)
      } catch (error) {
        request.log.error({ err: error }, 'Failed to record Gmail disconnect request')
        return reply.code(502).send({ error: { code: 'revocation_failed', message: 'Gmail could not be disconnected. Please try again.' } })
      }
      const encryptedToken = repository.getEncryptedRefreshToken ? await repository.getEncryptedRefreshToken(request.user.id) : null
      const refreshToken = decryptRefreshToken(encryptedToken)
      // SEC-041-02: an ambiguous transport outcome (the provider itself
      // threw, meaning the request may never have reached Google or its
      // response was lost in transit) is not the same thing as a definitive
      // rejection. We genuinely do not know whether Google already
      // processed the revocation, so this must be treated exactly like the
      // 'revocation_ambiguous' status below: never cancel the pending
      // marker, never purge, keep the token, return a retryable error.
      let revocation
      try {
        revocation = await provider.revokeConnection({ token: refreshToken })
      } catch (error) {
        request.log.error({ err: error }, 'Gmail token revocation could not be confirmed (provider threw)')
        return reply.code(502).send({ error: { code: 'revocation_uncertain', message: 'Gmail disconnect could not be confirmed. Please try again.' } })
      }
      if (revocation?.status === 'revocation_ambiguous') {
        // A network/transport failure inside the provider (see
        // server/auth/googleProvider.js's revokeConnection): the request may
        // have reached Google and been processed successfully with the
        // response simply lost, or it may never have arrived at all. Either
        // way, reactivating the connection (cancelGmailDisconnect) would
        // risk reporting "connected" for a token Google may have already
        // revoked - so the connection stays at 'revoke_requested' (still
        // scan-blocked, token still retained for a retry that can safely
        // re-attempt revocation, since revoking an already-revoked token is
        // a documented no-op) rather than being reverted.
        request.log.error({ revocation }, 'Gmail token revocation outcome is ambiguous')
        return reply.code(502).send({ error: { code: 'revocation_uncertain', message: 'Gmail disconnect could not be confirmed. Please try again.' } })
      }
      if (revocation?.status !== 'disconnected') {
        // A *definitive* negative answer from the provider - a completed
        // exchange with Google that came back rejected, or no usable token
        // to send at all - not an ambiguous transport failure, so it's safe
        // (and matches the pre-existing CASE B guarantee) to revert
        // beginGmailDisconnect's marker: the connection stays fully usable
        // for a retry rather than sitting scan-blocked over a revocation
        // that we know, with certainty, never happened.
        await tryCancelGmailDisconnect()
        return reply.code(502).send({ error: { code: 'revocation_failed', message: 'Gmail could not be disconnected. Please try again.' } })
      }
      try {
        await withRetries(() => repository.markGmailRevoked(request.user.id))
      } catch (error) {
        request.log.error({ err: error }, 'Failed to record confirmed Gmail revocation')
        return reply.code(502).send({ error: { code: 'revocation_confirmation_failed', message: 'Gmail access was revoked, but this could not be recorded yet. Please try again.' } })
      }
    }
    // Do not report success until the local purge has actually completed -
    // a thrown error here (e.g. a transient DB failure) must surface as a
    // recoverable failure, not a silent 500, so the frontend's existing
    // retry path (the disconnect button remains available on any failure)
    // reaches this same recovery logic on the next attempt.
    try {
      return await repository.disconnectConnection(request.user.id)
    } catch (error) {
      request.log.error({ err: error }, 'Local Gmail data purge failed after confirmed revocation')
      return reply.code(502).send({ error: { code: 'purge_failed', message: 'Gmail access was revoked, but some local data could not be cleared yet. Please try again.' } })
    }
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

  // MVP-BETA-004 (#41): full account deletion. Ownership is exclusively
  // request.user.id (set by the session preHandler above from the caller's
  // own cookie) - there is no request body/param to read an id from at all,
  // so a client can never even attempt to name another account here.
  //
  // Gmail revocation is best-effort and never blocks deletion: unlike
  // POST /sources/gmail/disconnect (which must not report "disconnected"
  // until Google confirms revocation, since the account and the connection
  // both keep existing afterward), the account itself is being permanently
  // destroyed either way - our copy of the refresh token is deleted as part
  // of repository.deleteAccount regardless of whether Google's revoke call
  // succeeds, so a flaky revocation call can never leave the user unable to
  // delete their account. A failure is logged so it's visible operationally,
  // and the user can separately revoke Subtle AI's access from their Google
  // account permissions if the automatic revocation didn't go through.
  app.delete('/api/v1/account', { preHandler: requireUser }, async (request, reply) => {
    const encryptedToken = repository.getEncryptedRefreshToken ? await repository.getEncryptedRefreshToken(request.user.id) : null
    const refreshToken = decryptRefreshToken(encryptedToken)
    if (refreshToken) {
      try { await provider.revokeConnection({ token: refreshToken }) }
      catch (error) { request.log.error({ err: error }, 'Gmail token revocation failed during account deletion; proceeding with deletion anyway') }
    }
    await repository.deleteAccount(request.user.id)
    await sessions.revokeAllForUser(request.user.id)
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return { status: 'deleted' }
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
