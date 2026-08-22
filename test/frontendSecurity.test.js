import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// Static, source-level checks for the frontend security constraints that can't
// be exercised without a DOM: the frontend must never talk to Google directly,
// never persist tokens/session-cookie values itself, and must always let the
// backend originate the OAuth redirect target.
const srcDir = new URL('../src/', import.meta.url)
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = join(dir, entry.name)
  if (entry.isDirectory()) return walk(full)
  return entry.name.endsWith('.js') ? [full] : []
})
const jsFiles = walk(new URL(srcDir).pathname)
const sources = jsFiles.map((file) => ({ file, text: readFileSync(file, 'utf8') }))

test('no frontend source file calls Google APIs directly', () => {
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /accounts\.google\.com|googleapis\.com|oauth2\.googleapis/, `${file} must not reference a Google API host - the backend owns all Google/OAuth calls`)
  }
})

test('no frontend source file writes to localStorage, sessionStorage, or IndexedDB', () => {
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /localStorage\.|sessionStorage\.|indexedDB\b/, `${file} must not persist state in browser storage - session/Gmail state is backend-owned`)
  }
})

test('no frontend source file reads document.cookie', () => {
  for (const { file, text } of sources) {
    assert.doesNotMatch(text, /document\.cookie/, `${file} must not read cookies - the session cookie is HttpOnly and backend-managed`)
  }
})

test('the OAuth redirect target always comes from a backend response, never a client-constructed URL', () => {
  const main = readFileSync(new URL('main.js', srcDir), 'utf8')
  // Both navigations must read `.url` off an awaited API response, not build a
  // URL from client-side pieces (client id, scope, etc. never appear here).
  assert.match(main, /startGoogleSignIn\(\)[\s\S]{0,80}url/)
  assert.match(main, /authorizeGmail\(\)[\s\S]{0,80}url/)
  assert.doesNotMatch(main, /client_id|scope=/i)
})
