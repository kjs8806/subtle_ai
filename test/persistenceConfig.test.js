import assert from 'node:assert/strict'
import test from 'node:test'
import { validateConfig } from '../server/config/env.js'

const base = {
  gmailProvider: 'mock',
  persistenceProvider: 'memory',
  production: false,
  sessionSecret: 'a'.repeat(32),
  databaseUrl: '',
  tokenEncryptionKey: '',
  googleClientId: '',
  googleClientSecret: '',
  googleOidcRedirectUri: '',
  googleGmailRedirectUri: '',
}

test('memory persistence passes validation for mock Gmail', () => {
  assert.doesNotThrow(() => validateConfig({ ...base }))
})

test('postgres persistence requires DATABASE_URL', () => {
  assert.throws(() => validateConfig({ ...base, persistenceProvider: 'postgres', databaseUrl: '' }), /DATABASE_URL is required/)
  assert.doesNotThrow(() => validateConfig({ ...base, persistenceProvider: 'postgres', databaseUrl: 'postgresql://localhost/test' }))
})

test('unknown persistence provider is rejected', () => {
  assert.throws(() => validateConfig({ ...base, persistenceProvider: 'sqlite' }), /PERSISTENCE_PROVIDER must be memory or postgres/)
})

test('real Gmail provider requires PostgreSQL persistence', () => {
  const googleSettings = { ...base, gmailProvider: 'google', persistenceProvider: 'memory', tokenEncryptionKey: 'a'.repeat(32), googleClientId: 'id', googleClientSecret: 'secret', googleOidcRedirectUri: 'https://app.example/oidc', googleGmailRedirectUri: 'https://app.example/gmail' }
  assert.throws(() => validateConfig(googleSettings), /PERSISTENCE_PROVIDER must be postgres when GMAIL_PROVIDER=google/)
  assert.doesNotThrow(() => validateConfig({ ...googleSettings, persistenceProvider: 'postgres', databaseUrl: 'postgresql://localhost/test' }))
})

// MVP-BETA-007 (#44): production beta deployment must fail closed - it must
// never silently boot with ephemeral memory persistence or the mock Gmail
// provider, since either would look "healthy" while actually being an unsafe
// fake beta. These are the release-check tests for that guarantee.
const productionGoogleSettings = {
  ...base,
  production: true,
  gmailProvider: 'google',
  persistenceProvider: 'postgres',
  databaseUrl: 'postgresql://localhost/test',
  sessionSecret: 'a'.repeat(32),
  tokenEncryptionKey: 'a'.repeat(32),
  googleClientId: 'id',
  googleClientSecret: 'secret',
  googleOidcRedirectUri: 'https://app.example/oidc',
  googleGmailRedirectUri: 'https://app.example/gmail',
}

test('production rejects memory persistence even with the real Gmail provider', () => {
  assert.throws(
    () => validateConfig({ ...productionGoogleSettings, persistenceProvider: 'memory' }),
    /PERSISTENCE_PROVIDER must be postgres when NODE_ENV=production/
  )
})

test('production rejects the mock Gmail provider even with PostgreSQL persistence', () => {
  assert.throws(
    () => validateConfig({ ...productionGoogleSettings, gmailProvider: 'mock' }),
    /GMAIL_PROVIDER must be google when NODE_ENV=production/
  )
})

test('production rejects memory persistence and mock Gmail provider together', () => {
  assert.throws(
    () => validateConfig({ ...productionGoogleSettings, gmailProvider: 'mock', persistenceProvider: 'memory', tokenEncryptionKey: '', googleClientId: '', googleClientSecret: '', googleOidcRedirectUri: '', googleGmailRedirectUri: '' }),
    /PERSISTENCE_PROVIDER must be postgres when NODE_ENV=production/
  )
})

test('a complete, valid production configuration passes validation', () => {
  assert.doesNotThrow(() => validateConfig({ ...productionGoogleSettings }))
})
