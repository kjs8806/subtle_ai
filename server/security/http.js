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

export const createRateLimiter = ({ limit = 60, windowMs = 60_000, now = () => Date.now() } = {}) => {
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
