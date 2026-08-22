// All requests are same-origin; the session cookie is HttpOnly and attached by
// the browser automatically (credentials: 'same-origin' is fetch's default for
// same-origin requests, kept explicit here so that never silently changes).
const request = async (path, options = {}) => {
  let response
  try {
    const headers = options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers
    response = await fetch(path, { headers, credentials: 'same-origin', ...options })
  } catch (cause) {
    const error = new Error('Network request failed')
    error.code = 'network_error'
    error.status = null
    error.cause = cause
    throw error
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Request failed')
    error.code = payload.error?.code || null
    error.status = response.status
    throw error
  }
  return payload
}

export const feature001Api = {
  getSession: () => request('/api/v1/session'),
  startGoogleSignIn: () => request('/api/v1/auth/google/start'),
  logout: () => request('/api/v1/auth/logout', { method: 'POST' }),
  getGmailSource: () => request('/api/v1/sources/gmail'),
  authorizeGmail: () => request('/api/v1/sources/gmail/authorize', { method: 'POST' }),
  scanGmail: () => request('/api/v1/sources/gmail/scan', { method: 'POST' }),
  disconnectGmail: () => request('/api/v1/sources/gmail/disconnect', { method: 'POST' }),
  listSubscriptions: () => request('/api/v1/subscriptions'),
  getSubscription: (id) => request(`/api/v1/subscriptions/${encodeURIComponent(id)}`),
}
