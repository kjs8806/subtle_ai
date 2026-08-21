const decode = (data) => {
  if (!data) return ''
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

const collectText = (payload) => {
  if (Array.isArray(payload)) return payload.reduce((result, part) => {
    const nested = collectText(part)
    result.plain.push(...nested.plain)
    result.html.push(...nested.html)
    result.other.push(...nested.other)
    return result
  }, { plain: [], html: [], other: [] })
  if (!payload || typeof payload !== 'object') return { plain: [], html: [], other: [] }
  const result = { plain: [], html: [], other: [] }
  const mimeType = String(payload.mimeType || '').toLowerCase()
  const decoded = decode(payload.body?.data)
  if (mimeType === 'text/plain' && decoded.trim()) result.plain.push(decoded)
  else if (mimeType === 'text/html' && decoded.trim()) result.html.push(decoded)
  else if (!mimeType.startsWith('multipart/') && decoded.trim()) result.other.push(decoded)
  for (const part of payload.parts || []) {
    const nested = collectText(part)
    result.plain.push(...nested.plain)
    result.html.push(...nested.html)
    result.other.push(...nested.other)
  }
  return result
}

export const adaptGmailMessage = (message = {}) => {
  const payload = message.payload || {}
  const headers = Object.fromEntries((payload.headers || []).map(({ name, value }) => [String(name || '').toLowerCase(), value || '']))
  const content = collectText(payload)
  const body = content.plain.join('\n').trim() || content.html.map(stripHtml).filter(Boolean).join('\n').trim() || content.other.join('\n').trim()
  return {
    id: message.id || '',
    subject: headers.subject || '',
    sender: headers.from || '',
    receivedAt: headers.date || null,
    body,
  }
}