// Gmail message content is attacker-controlled: bound decode size, MIME part
// count, and nesting depth so a malicious message can't force unbounded
// memory use or recursion during scanning.
const MAX_DECODED_BYTES = 200 * 1024
const MAX_ENCODED_LENGTH = Math.ceil(MAX_DECODED_BYTES / 3) * 4
const MAX_PARTS = 40
const MAX_DEPTH = 10
const MAX_BODY_LENGTH = 300 * 1024

const decode = (data) => {
  if (!data || typeof data !== 'string') return ''
  if (data.length > MAX_ENCODED_LENGTH) return ''
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(data)) return ''
  try { return Buffer.from(data, 'base64url').toString('utf8') } catch { return '' }
}

const stripHtml = (html) => String(html || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<br\s*\/?>(?=.)/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/\s+/g, ' ')
  .trim()

const collectText = (payload, depth = 0, counter = { parts: 0 }) => {
  const empty = { plain: [], html: [], other: [] }
  // Depth and total-part budgets are shared across the whole recursion (via
  // `counter` and the propagated `depth`), so a wide-and-shallow or a
  // narrow-and-deep adversarial MIME tree are both bounded the same way.
  if (depth > MAX_DEPTH) return empty
  if (Array.isArray(payload)) return payload.reduce((result, part) => {
    if (counter.parts >= MAX_PARTS) return result
    counter.parts += 1
    const nested = collectText(part, depth + 1, counter)
    result.plain.push(...nested.plain)
    result.html.push(...nested.html)
    result.other.push(...nested.other)
    return result
  }, empty)
  if (!payload || typeof payload !== 'object') return empty
  const result = { plain: [], html: [], other: [] }
  const mimeType = String(payload.mimeType || '').toLowerCase()
  const decoded = decode(payload.body?.data)
  if (mimeType === 'text/plain' && decoded.trim()) result.plain.push(decoded)
  else if (mimeType === 'text/html' && decoded.trim()) result.html.push(decoded)
  else if (!mimeType.startsWith('multipart/') && decoded.trim()) result.other.push(decoded)
  for (const part of payload.parts || []) {
    if (counter.parts >= MAX_PARTS) break
    counter.parts += 1
    const nested = collectText(part, depth + 1, counter)
    result.plain.push(...nested.plain)
    result.html.push(...nested.html)
    result.other.push(...nested.other)
  }
  return result
}

// The Date header is attacker-controlled, free-form email text (e.g. Gmail
// commonly sends RFC 2822 dates with a trailing "(UTC)" annotation that
// PostgreSQL's timestamptz parser rejects outright), so it's never persisted
// as-is. Gmail's own internalDate (server-assigned receipt time, epoch ms) is
// preferred when present; the Date header is only a fallback, and either way
// this normalizes to ISO 8601 or gives up cleanly rather than passing raw text
// through to storage.
const parseReceivedAt = (message, headers) => {
  const internalMs = Number(message.internalDate)
  if (Number.isFinite(internalMs) && internalMs > 0) return new Date(internalMs).toISOString()
  const parsed = new Date(headers.date || '')
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

export const adaptGmailMessage = (message = {}) => {
  const payload = message.payload || {}
  const headers = Object.fromEntries((payload.headers || []).map(({ name, value }) => [String(name || '').toLowerCase(), value || '']))
  const content = collectText(payload)
  const body = (content.plain.join('\n').trim() || content.html.map(stripHtml).filter(Boolean).join('\n').trim() || content.other.join('\n').trim()).slice(0, MAX_BODY_LENGTH)
  return {
    id: message.id || '',
    subject: headers.subject || '',
    sender: headers.from || '',
    receivedAt: parseReceivedAt(message, headers),
    body,
  }
}