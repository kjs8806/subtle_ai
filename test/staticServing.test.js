import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { buildApp } from '../server/app.js'

// MVP-BETA-007 (#44): static serving only registers when dist/ (the built
// Vite PWA) actually exists on disk - see server/app.js's own comment on
// why. `npm test` runs before `npm run build` in CI (deploy.yml, ci.yml), so
// dist/ is legitimately absent there; this suite mirrors the
// DATABASE_URL-gated `integration` pattern used elsewhere in test/ rather
// than fabricating a fake dist/ that wouldn't prove anything about the real
// build output. Run `npm run build` locally first to exercise this suite.
const distDir = fileURLToPath(new URL('../dist', import.meta.url))
const withBuiltApp = existsSync(distDir) ? test : test.skip

withBuiltApp('serves the built index.html at the SPA root', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/' })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'], /text\/html/)
  assert.match(response.body, /<html/i)
})

withBuiltApp('falls back to index.html for unmatched client-side routes', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/subscriptions/some-id-that-is-not-a-file' })
  assert.equal(response.statusCode, 200)
  assert.match(response.headers['content-type'], /text\/html/)
  assert.match(response.body, /<html/i)
})

withBuiltApp('unmatched /api/v1 routes still 404 as JSON, never falling back to index.html', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/api/v1/this-route-does-not-exist' })
  assert.equal(response.statusCode, 404)
  assert.deepEqual(response.json(), { error: { code: 'not_found', message: 'Not found' } })
})

withBuiltApp('serves real static assets (e.g. the manifest) directly, not the SPA fallback', async () => {
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/manifest.webmanifest' })
  assert.equal(response.statusCode, 200)
  assert.doesNotMatch(response.body, /<html/i)
})

test('when dist/ is absent, the app still boots and serves the API without registering static routes', async () => {
  if (existsSync(distDir)) return // this session's dist/ is present; nothing extra to assert beyond the withBuiltApp suite above
  const app = buildApp()
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' })
  assert.equal(response.statusCode, 200)
})
