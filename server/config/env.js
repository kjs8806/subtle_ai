export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  gmailProvider: process.env.GMAIL_PROVIDER || 'mock',
  sessionSecret: process.env.SESSION_SECRET || 'local-development-only',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  databaseUrl: process.env.DATABASE_URL || '',
  production: process.env.NODE_ENV === 'production',
  publicOrigin: process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:5173',
}

export const validateConfig = (settings = config) => {
  if (!['mock', 'google'].includes(settings.gmailProvider)) throw new Error('GMAIL_PROVIDER must be mock or google')
  if (settings.production && (!settings.sessionSecret || settings.sessionSecret === 'local-development-only' || settings.sessionSecret.length < 32)) throw new Error('SESSION_SECRET must be a strong production secret')
  if (settings.gmailProvider === 'google') {
    for (const [name, value] of [['GOOGLE_CLIENT_ID', settings.googleClientId], ['GOOGLE_CLIENT_SECRET', settings.googleClientSecret], ['GOOGLE_REDIRECT_URI', settings.googleRedirectUri], ['TOKEN_ENCRYPTION_KEY', settings.tokenEncryptionKey]]) if (!value) throw new Error(`${name} is required when GMAIL_PROVIDER=google`)
    if (settings.tokenEncryptionKey.length < 32) throw new Error('TOKEN_ENCRYPTION_KEY must be at least 32 characters')
  }
  return settings
}

validateConfig()
