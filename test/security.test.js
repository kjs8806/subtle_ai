import assert from 'node:assert/strict'
import test from 'node:test'
import { createGoogleProvider } from '../server/auth/googleProvider.js'
import { validateConfig } from '../server/config/env.js'
import { createTokenVault } from '../server/security/tokenVault.js'

test('token vault encrypts and authenticates refresh tokens', () => {
  const vault = createTokenVault({ secret: 'a'.repeat(32) })
  const encrypted = vault.encrypt('refresh-token')
  assert.notEqual(encrypted.ciphertext, 'refresh-token')
  assert.equal(encrypted.keyVersion, 'v1')
  assert.equal(vault.decrypt(encrypted), 'refresh-token')
  assert.throws(() => vault.decrypt(`${encrypted}x`))
  assert.throws(() => createTokenVault({ secret: 'short' }), /at least 32/)
})

test('google configuration fails closed without credentials', () => {
  assert.throws(() => validateConfig({ gmailProvider: 'google', production: false, googleClientId: '', googleClientSecret: '', googleOidcRedirectUri: '', googleGmailRedirectUri: '', tokenEncryptionKey: '' }), /GOOGLE_CLIENT_ID/)
  assert.throws(() => validateConfig({ gmailProvider: 'mock', production: true, sessionSecret: 'local-development-only' }), /SESSION_SECRET/)
})

test('real provider requests only the approved OIDC and Gmail scopes', () => {
  const provider = createGoogleProvider({ clientId: 'client', clientSecret: 'secret', oidcRedirectUri: 'https://app.example/oidc', gmailRedirectUri: 'https://app.example/gmail' })
  const signIn = new URL(provider.createAuthorizationRequest({ state: 'one' }).url)
  const gmail = new URL(provider.createGmailAuthorizationRequest({ state: 'two' }).url)
  assert.equal(signIn.searchParams.get('scope'), 'openid email profile')
  assert.equal(gmail.searchParams.get('scope'), 'https://www.googleapis.com/auth/gmail.readonly')
  assert.equal(signIn.searchParams.get('redirect_uri'), 'https://app.example/oidc')
  assert.equal(gmail.searchParams.get('redirect_uri'), 'https://app.example/gmail')
})