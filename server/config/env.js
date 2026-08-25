// MVP-BETA-007 (#44): Cloud Run always requires the container to listen on
// all interfaces (0.0.0.0), not localhost - traffic arrives over the
// container's network interface, and a 127.0.0.1-only listener is simply
// unreachable there. Local development keeps the tighter 127.0.0.1 default
// (nothing outside the dev machine should be able to reach the mock API),
// so this is gated on NODE_ENV=production rather than changed unconditionally.
const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1'),
  gmailProvider: process.env.GMAIL_PROVIDER || 'mock',
  sessionSecret: process.env.SESSION_SECRET || 'local-development-only',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleOidcRedirectUri: process.env.GOOGLE_OIDC_REDIRECT_URI || '',
  googleGmailRedirectUri: process.env.GOOGLE_GMAIL_REDIRECT_URI || '',
  databaseUrl: process.env.DATABASE_URL || '',
  persistenceProvider: process.env.PERSISTENCE_PROVIDER || 'memory',
  production: isProduction,
  publicOrigin: process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:5173',
  // MVP-BETA-007 (#44): conservative, Cloud-Run-elastic-aware PostgreSQL pool
  // sizing - see server/bootstrap.js and docs/engineering/DEPLOYMENT.md for
  // the full rationale (Neon free-tier connection ceiling combined with an
  // unbounded number of Cloud Run instances each opening their own pool).
  dbPoolMax: Number(process.env.DB_POOL_MAX || 5),
  dbPoolIdleTimeoutMs: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS || 10_000),
  dbPoolConnectionTimeoutMs: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || 5_000),
}

export const validateConfig = (settings = config) => {
  if (!['mock', 'google'].includes(settings.gmailProvider)) throw new Error('GMAIL_PROVIDER must be mock or google')
  if (!['memory', 'postgres'].includes(settings.persistenceProvider)) throw new Error('PERSISTENCE_PROVIDER must be memory or postgres')
  if (settings.production && (!settings.sessionSecret || settings.sessionSecret === 'local-development-only' || settings.sessionSecret.length < 32)) throw new Error('SESSION_SECRET must be a strong production secret')
  // MVP-BETA-007 (#44): the deployed public-beta environment must fail
  // closed rather than silently run the mock Gmail provider or ephemeral
  // memory persistence - neither is a "superficially healthy" state that's
  // safe to serve real users from. This is deliberately checked on
  // NODE_ENV=production alone (not GMAIL_PROVIDER=google, which is what
  // other cookie/origin hardening keys off) so that it fires the moment a
  // production deployment is misconfigured, before any real-Gmail-specific
  // logic is even reached.
  if (settings.production && settings.persistenceProvider !== 'postgres') throw new Error('PERSISTENCE_PROVIDER must be postgres when NODE_ENV=production')
  if (settings.production && settings.gmailProvider !== 'google') throw new Error('GMAIL_PROVIDER must be google when NODE_ENV=production')
  if (settings.gmailProvider === 'google') {
    for (const [name, value] of [['GOOGLE_CLIENT_ID', settings.googleClientId], ['GOOGLE_CLIENT_SECRET', settings.googleClientSecret], ['GOOGLE_OIDC_REDIRECT_URI', settings.googleOidcRedirectUri], ['GOOGLE_GMAIL_REDIRECT_URI', settings.googleGmailRedirectUri], ['TOKEN_ENCRYPTION_KEY', settings.tokenEncryptionKey]]) if (!value) throw new Error(`${name} is required when GMAIL_PROVIDER=google`)
    if (settings.tokenEncryptionKey.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 characters')
    if (settings.persistenceProvider === 'memory') throw new Error('PERSISTENCE_PROVIDER must be postgres when GMAIL_PROVIDER=google')
  }
  if (settings.persistenceProvider === 'postgres' && !settings.databaseUrl) throw new Error('DATABASE_URL is required when PERSISTENCE_PROVIDER=postgres')
  return settings
}

validateConfig()
