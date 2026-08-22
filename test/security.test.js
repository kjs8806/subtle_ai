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

test('SEC-006: mutating the IV, auth tag, or ciphertext of an AES-GCM token independently breaks decryption', () => {
  const vault = createTokenVault({ secret: 'a'.repeat(32) })
  const { ciphertext, keyVersion } = vault.encrypt('refresh-token')
  const [version, iv, tag, body] = ciphertext.split('.')

  // Flip the leading bit of the segment's first byte rather than its last base64url
  // character: base64url's final character of a non-multiple-of-4 segment can carry
  // unused low bits, so mutating it does not always change the decoded bytes.
  const flipFirstBit = (segment) => {
    const buffer = Buffer.from(segment, 'base64url')
    buffer[0] ^= 0x01
    return buffer.toString('base64url')
  }

  assert.throws(() => vault.decrypt({ ciphertext: [version, flipFirstBit(iv), tag, body].join('.'), keyVersion }), 'mutated IV must fail authentication')
  assert.throws(() => vault.decrypt({ ciphertext: [version, iv, flipFirstBit(tag), body].join('.'), keyVersion }), 'mutated auth tag must fail authentication')
  assert.throws(() => vault.decrypt({ ciphertext: [version, iv, tag, flipFirstBit(body)].join('.'), keyVersion }), 'mutated ciphertext body must fail authentication')
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

test('SEC-006: revokeConnection treats a missing or empty token as unverified, never as disconnected, and never contacts Google', async () => {
  let called = false
  const provider = createGoogleProvider({ clientId: 'client', clientSecret: 'secret', oidcRedirectUri: 'https://app.example/oidc', gmailRedirectUri: 'https://app.example/gmail', fetchImpl: async () => { called = true; return { ok: true } } })

  for (const token of [undefined, null, '']) {
    called = false
    const result = await provider.revokeConnection({ token })
    assert.equal(result.status, 'revocation_failed', `token ${JSON.stringify(token)} must not be reported as disconnected`)
    assert.equal(called, false, 'Google must never be contacted without a usable token')
  }
})

test('SEC-005: the real Gmail exchange normalizes a successful token+identity lookup into status "authorized" with the connected mailbox\'s email and refresh token', async () => {
  // A gmail.readonly-only token carries no OIDC claims, so Google's tokeninfo
  // never returns a `sub` for it - the real identity lookup is Gmail's own
  // profile endpoint (already covered by gmail.readonly), keyed by email.
  const fetchImpl = async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') return { ok: true, json: async () => ({ access_token: 'gmail-access-token', refresh_token: 'real-refresh-token', token_type: 'Bearer', expires_in: 3600 }) }
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return { ok: true, json: async () => ({ emailAddress: 'person@example.com' }) }
    throw new Error(`Unexpected fetch to ${url}`)
  }
  const provider = createGoogleProvider({ clientId: 'client', clientSecret: 'secret', oidcRedirectUri: 'https://app.example/oidc', gmailRedirectUri: 'https://app.example/gmail', fetchImpl })

  const result = await provider.exchangeGmailAuthorizationCode({ code: 'real-authorization-code' })
  assert.equal(result.status, 'authorized')
  assert.equal(result.email, 'person@example.com')
  assert.equal(result.refresh_token, 'real-refresh-token')
})

test('refreshAccessToken normalizes Google\'s raw access_token into the accessToken (camelCase) contract callers read', async () => {
  // Google's token endpoint returns snake_case (access_token); the scan path
  // reads access.accessToken (camelCase, matching the fake provider's stub) -
  // without normalization every real scan would send "Authorization: Bearer
  // undefined".
  const provider = createGoogleProvider({
    clientId: 'client', clientSecret: 'secret', oidcRedirectUri: 'https://app.example/oidc', gmailRedirectUri: 'https://app.example/gmail',
    fetchImpl: async () => ({ ok: true, json: async () => ({ access_token: 'fresh-access-token', token_type: 'Bearer', expires_in: 3600 }) }),
  })
  const result = await provider.refreshAccessToken('some-refresh-token')
  assert.equal(result.accessToken, 'fresh-access-token')
  assert.equal(result.access_token, 'fresh-access-token')
})

test('SEC-005: a failed Gmail token exchange or identity lookup throws and is never normalized to authorized', async () => {
  const tokenFailure = createGoogleProvider({ clientId: 'client', clientSecret: 'secret', oidcRedirectUri: 'https://app.example/oidc', gmailRedirectUri: 'https://app.example/gmail', fetchImpl: async () => ({ ok: false, status: 400 }) })
  await assert.rejects(tokenFailure.exchangeGmailAuthorizationCode({ code: 'irrelevant' }))

  const identityFailure = createGoogleProvider({
    clientId: 'client', clientSecret: 'secret', oidcRedirectUri: 'https://app.example/oidc', gmailRedirectUri: 'https://app.example/gmail',
    fetchImpl: async (url) => {
      if (url === 'https://oauth2.googleapis.com/token') return { ok: true, json: async () => ({ access_token: 'gmail-access-token', refresh_token: 'real-refresh-token' }) }
      return { ok: false, status: 400 }
    },
  })
  await assert.rejects(identityFailure.exchangeGmailAuthorizationCode({ code: 'irrelevant' }))
})