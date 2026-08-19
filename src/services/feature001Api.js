const request = async (path, options = {}) => {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...options.headers }, ...options })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || 'Request failed')
  return payload
}

export const feature001Api = {
  getSource: () => request('/api/v1/sources/gmail'),
  startAuthorization: () => request('/api/v1/auth/google/start'),
  completeAuthorization: (url) => request(url),
  scan: () => request('/api/v1/sources/gmail/scan', { method: 'POST' }),
  disconnect: () => request('/api/v1/sources/gmail/disconnect', { method: 'POST' }),
  listSubscriptions: () => request('/api/v1/subscriptions'),
  getSubscription: (id) => request(`/api/v1/subscriptions/${encodeURIComponent(id)}`),
}
