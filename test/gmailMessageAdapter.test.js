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