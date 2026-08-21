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
  assert.throws(() => validateConfig({ gmailProvider: 'google', persistenceProvider: 'postgres', databaseUrl: 'postgresql://localhost/test', production: false, googleClientId: '', googleClientSecret: '', googleOidcRedirectUri: '', googleGmailRedirectUri: '', tokenEncryptionKey: '' }), /GOOGLE_CLIENT_ID/)
  assert.throws(() => validateConfig({ gmailProvider: 'mock', persistenceProvider: 'memory', production: true, sessionSecret: 'local-development-only' }), /SESSION_SECRET/)
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

test('SEC-004: revokeConnection verifies the HTTP result, sends the token in the POST body, and treats network errors as failure', async () => {
  const provider = (fetchImpl) => createGoogleProvider({ clientId: 'client', clientSecret: 'secret', oidcRedirectUri: 'https://app.example/oidc', gmailRedirectUri: 'https://app.example/gmail', fetchImpl })

  let calledUrl = null
  let calledBody = null
  const success = provider(async (url, options) => { calledUrl = url; calledBody = options.body?.toString(); return { ok: true } })
  const okResult = await success.revokeConnection({ token: 'refresh-token' })
  assert.equal(okResult.status, 'disconnected')
  assert.equal(calledUrl, 'https://oauth2.googleapis.com/revoke')
  assert.match(calledBody, /token=refresh-token/)
  assert.equal(calledUrl.includes('refresh-token'), false, 'the token must not be sent in the URL')

  const httpFailure = provider(async () => ({ ok: false, status: 400 }))
  const failedResult = await httpFailure.revokeConnection({ token: 'refresh-token' })
  assert.equal(failedResult.status, 'revocation_failed')

  const networkFailure = provider(async () => { throw new Error('network unreachable') })
  const exceptionResult = await networkFailure.revokeConnection({ token: 'refresh-token' })
  assert.equal(exceptionResult.status, 'revocation_failed')
})