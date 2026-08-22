import assert from 'node:assert/strict'
import test from 'node:test'
import { adaptGmailMessage } from '../server/gmail/messageAdapter.js'

const encoded = (value) => Buffer.from(value).toString('base64url')
const headers = [{ name: 'Subject', value: 'Netflix receipt' }, { name: 'From', value: 'billing@netflix.com' }, { name: 'Date', value: '2026-08-19' }]

test('adapts a plain-text Gmail receipt', () => {
  const result = adaptGmailMessage({ id: 'plain', payload: { headers, mimeType: 'text/plain', body: { data: encoded('Your receipt is $22.99') } } })
  assert.equal(result.body, 'Your receipt is $22.99')
  assert.equal(result.subject, 'Netflix receipt')
})

test('prefers meaningful plain text in multipart alternative', () => {
  const result = adaptGmailMessage({ id: 'alternative', payload: { headers, mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: encoded('Plain receipt $22.99') } }, { mimeType: 'text/html', body: { data: encoded('<p>HTML receipt $99.99</p>') } }] } })
  assert.equal(result.body, 'Plain receipt $22.99')
})

test('converts HTML-only and nested multipart messages', () => {
  const result = adaptGmailMessage({ id: 'nested', payload: { headers, mimeType: 'multipart/mixed', parts: [{ mimeType: 'application/pdf', body: { data: encoded('ignored attachment') } }, { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: encoded('<p>Nested receipt<br>$22.99</p>') } }] }] } })
  assert.match(result.body, /Nested receipt/)
  assert.match(result.body, /\$22.99/)
})

test('handles empty and malformed payloads without exposing raw HTML', () => {
  assert.equal(adaptGmailMessage({ id: 'empty', payload: {} }).body, '')
  const result = adaptGmailMessage({ id: 'malformed', payload: { mimeType: 'text/html', body: { data: '%%%not-base64%%%' } } })
  assert.equal(result.body, '')
})

test('handles a payload whose parts field is not an array without crashing', () => {
  const result = adaptGmailMessage({ id: 'weird-parts', payload: { headers, mimeType: 'multipart/mixed', parts: 'not-an-array' } })
  assert.equal(result.body, '')
})

test('skips a single decoded part that exceeds the size bound instead of allocating it', () => {
  const huge = encoded('x'.repeat(500_000))
  const result = adaptGmailMessage({ id: 'oversized', payload: { headers, mimeType: 'text/plain', body: { data: huge } } })
  assert.equal(result.body, '')
})

test('bounds excessive MIME part counts instead of scanning every part', () => {
  const parts = Array.from({ length: 1000 }, (_, i) => ({ mimeType: 'text/plain', body: { data: encoded(`part-${i}`) } }))
  const result = adaptGmailMessage({ id: 'many-parts', payload: { headers, mimeType: 'multipart/mixed', parts } })
  assert.equal(result.body.includes('part-999'), false)
})

test('bounds deeply nested MIME structures instead of recursing without limit', () => {
  const leaf = { mimeType: 'text/plain', body: { data: encoded('deep receipt $9.99') } }
  const nested = Array.from({ length: 500 }).reduce((inner) => ({ mimeType: 'multipart/mixed', parts: [inner] }), leaf)
  const result = adaptGmailMessage({ id: 'deep-nesting', payload: { headers, mimeType: 'multipart/mixed', parts: [nested] } })
  assert.equal(result.body, '')
})

test('normal receipt scenarios remain unaffected by the resource bounds', () => {
  const result = adaptGmailMessage({ id: 'plain', payload: { headers, mimeType: 'text/plain', body: { data: encoded('Your receipt is $22.99') } } })
  assert.equal(result.body, 'Your receipt is $22.99')
})

test('normalizes a real Gmail Date header (RFC 2822 with a trailing zone annotation) to ISO 8601', () => {
  // Real Gmail messages commonly carry a Date header like this - the trailing
  // "(UTC)" is rejected outright by PostgreSQL's timestamptz parser, so it must
  // never be persisted as raw text.
  const rfc2822Headers = [{ name: 'Date', value: 'Sat, 08 Aug 2026 14:23:10 +0000 (UTC)' }]
  const result = adaptGmailMessage({ id: 'rfc2822-date', payload: { headers: rfc2822Headers, mimeType: 'text/plain', body: { data: encoded('receipt') } } })
  assert.equal(result.receivedAt, '2026-08-08T14:23:10.000Z')
})

test('prefers Gmail\'s own internalDate over the Date header when both are present', () => {
  const result = adaptGmailMessage({ id: 'internal-date', internalDate: '1754000000000', payload: { headers, mimeType: 'text/plain', body: { data: encoded('receipt') } } })
  assert.equal(result.receivedAt, new Date(1754000000000).toISOString())
})

test('falls back to null when neither internalDate nor the Date header can be parsed', () => {
  const badHeaders = [{ name: 'Date', value: 'not-a-real-date' }]
  const result = adaptGmailMessage({ id: 'bad-date', payload: { headers: badHeaders, mimeType: 'text/plain', body: { data: encoded('receipt') } } })
  assert.equal(result.receivedAt, null)
})