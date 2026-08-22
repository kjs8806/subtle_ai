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
