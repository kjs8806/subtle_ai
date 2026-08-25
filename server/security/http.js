const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const securityHeaders = async (_request, reply) => {
  reply.headers({
    'content-security-policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  })
}

export const enforceSameOrigin = ({ enforce, origin }) => async (request, reply) => {
  if (!enforce || SAFE_METHODS.has(request.method)) return
  const supplied = request.headers.origin
  if (!supplied || supplied !== origin) return reply.code(403).send({ error: { code: 'invalid_origin', message: 'Request origin rejected' } })
}

// Browser E2E projects intentionally drive many independent sessions through
// one loopback IP in a few seconds. That synthetic traffic can exhaust the
// real 60-request production limiter and turn unrelated responsive/a11y tests
// into 429 failures. Allow an explicit higher ceiling only under NODE_ENV=test;
// production/development behavior remains 60 even if E2E_RATE_LIMIT is set.
const defaultRateLimit = () => {
  if (process.env.NODE_ENV !== 'test') return 60
  const configured = Number(process.env.E2E_RATE_LIMIT)
  return Number.isFinite(configured) && configured > 0 ? configured : 60
}

export const createRateLimiter = ({ limit = defaultRateLimit(), windowMs = 60_000, now = () => Date.now() } = {}) => {
  const clients = new Map()
  return async (request, reply) => {
    const key = request.ip
    const current = clients.get(key)
    const entry = !current || current.resetAt <= now() ? { count: 0, resetAt: now() + windowMs } : current
    entry.count += 1
    clients.set(key, entry)
    if (entry.count > limit) return reply.code(429).send({ error: { code: 'rate_limited', message: 'Too many requests' } })
  }
}
