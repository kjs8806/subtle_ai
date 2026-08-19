export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '127.0.0.1',
  gmailProvider: process.env.GMAIL_PROVIDER || 'mock',
  sessionSecret: process.env.SESSION_SECRET || 'local-development-only',
}

if (config.gmailProvider !== 'mock') {
  throw new Error('Only GMAIL_PROVIDER=mock is supported until the Google provider is explicitly enabled.')
}
