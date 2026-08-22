import assert from 'node:assert/strict'
import test from 'node:test'
import { feature001Api } from '../src/services/feature001Api.js'

// feature001Api.js is the frontend's only path to the backend - these tests
// exercise it against a stubbed global fetch (no real network, no DOM), proving
// it calls the correct routes/methods, sends credentials, and turns backend
// error payloads into a consistent thrown-error shape the UI can branch on.
const withFetch = (impl, run) => async () => {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (path, options) => { calls.push({ path, options }); return impl(path, options) }
  try { await run(calls) } finally { globalThis.fetch = original }
}
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

test('getSession calls GET /api/v1/session with same-origin credentials', withFetch(
  () => jsonResponse(200, { authenticated: true, user: { id: '1' } }),
  async (calls) => {
    const result = await feature001Api.getSession()
    assert.equal(calls[0].path, '/api/v1/session')
    assert.equal(calls[0].options.credentials, 'same-origin')
    assert.deepEqual(result, { authenticated: true, user: { id: '1' } })
  },
))

test('startGoogleSignIn calls GET /api/v1/auth/google/start and returns the provider url untouched', withFetch(
  () => jsonResponse(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' }),
  async (calls) => {
    const result = await feature001Api.startGoogleSignIn()
    assert.equal(calls[0].path, '/api/v1/auth/google/start')
    assert.equal(calls[0].options.method, undefined)
    assert.equal(result.url, 'https://accounts.google.com/o/oauth2/v2/auth?x=1')
  },
))

test('authorizeGmail, scanGmail, disconnectGmail, and logout all POST to the correct routes', withFetch(
  () => jsonResponse(200, {}),
  async (calls) => {
    await feature001Api.authorizeGmail(); assert.deepEqual([calls[0].path, calls[0].options.method], ['/api/v1/sources/gmail/authorize', 'POST'])
    await feature001Api.scanGmail(); assert.deepEqual([calls[1].path, calls[1].options.method], ['/api/v1/sources/gmail/scan', 'POST'])
    await feature001Api.disconnectGmail(); assert.deepEqual([calls[2].path, calls[2].options.method], ['/api/v1/sources/gmail/disconnect', 'POST'])
    await feature001Api.logout(); assert.deepEqual([calls[3].path, calls[3].options.method], ['/api/v1/auth/logout', 'POST'])
  },
))

test('getGmailSource and listSubscriptions are plain GETs', withFetch(
  () => jsonResponse(200, {}),
  async (calls) => {
    await feature001Api.getGmailSource(); assert.equal(calls[0].path, '/api/v1/sources/gmail')
    await feature001Api.listSubscriptions(); assert.equal(calls[1].path, '/api/v1/subscriptions')
  },
))

test('getSubscription encodes the id into the URL', withFetch(
  () => jsonResponse(200, {}),
  async (calls) => {
    await feature001Api.getSubscription('a b/c')
    assert.equal(calls[0].path, '/api/v1/subscriptions/a%20b%2Fc')
  },
))

test('a non-2xx response throws an Error carrying the backend error code and HTTP status', withFetch(
  () => jsonResponse(409, { error: { code: 'identity_mismatch', message: 'The Gmail account does not match the signed-in account' } }),
  async () => {
    await assert.rejects(feature001Api.getGmailSource(), (error) => {
      assert.equal(error.code, 'identity_mismatch')
      assert.equal(error.status, 409)
      assert.equal(error.message, 'The Gmail account does not match the signed-in account')
      return true
    })
  },
))

test('a network failure throws a distinct network_error, never a raw exception', withFetch(
  () => { throw new Error('fetch failed') },
  async () => {
    await assert.rejects(feature001Api.getSession(), (error) => {
      assert.equal(error.code, 'network_error')
      assert.equal(error.status, null)
      return true
    })
  },
))
