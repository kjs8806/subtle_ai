const required = (value, name) => {
  if (!value) throw new Error(`${name} is required`)
  return value
}

export const createGoogleProvider = ({ clientId, clientSecret, redirectUri, fetchImpl = fetch }) => {
  required(clientId, 'GOOGLE_CLIENT_ID')
  required(clientSecret, 'GOOGLE_CLIENT_SECRET')
  required(redirectUri, 'GOOGLE_REDIRECT_URI')
  const authorization = (scope, state) => {
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state, access_type: 'offline', prompt: 'consent' })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }
  const exchange = async (code) => {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) })
    if (!response.ok) throw new Error('Google authorization exchange failed')
    return response.json()
  }
  const refresh = async (refreshToken) => {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }) })
    if (!response.ok) throw new Error('Google access token refresh failed')
    return response.json()
  }
  const user = async (accessToken) => {
    const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new Error('Google identity lookup failed')
    return response.json()
  }
  const start = ({ state, scope }) => ({ url: authorization(scope, state) })
  return {
    createAuthorizationRequest: ({ state }) => start({ state, scope: 'openid email profile' }),
    exchangeAuthorizationCode: async ({ code }) => {
      const tokens = await exchange(code)
      const identity = await user(tokens.access_token)
      return { status: 'authorized', subject: identity.sub, email: identity.email, name: identity.name, ...tokens }
    },
    createGmailAuthorizationRequest: ({ state }) => start({ state, scope: 'https://www.googleapis.com/auth/gmail.readonly' }),
    exchangeGmailAuthorizationCode: async ({ code }) => {
      const tokens = await exchange(code)
      const identity = await user(tokens.access_token)
      return { ...tokens, subject: identity.sub }
    },
    refreshAccessToken: refresh,
    listCandidateMessages: async ({ accessToken }) => {
      const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=receipt+OR+renewal&maxResults=50', { headers: { authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Gmail message search failed')
      const listing = await response.json()
      return Promise.all((listing.messages || []).map(async ({ id }) => {
        const message = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { authorization: `Bearer ${accessToken}` } })
        if (!message.ok) throw new Error('Gmail message lookup failed')
        const data = await message.json()
        const headers = Object.fromEntries((data.payload?.headers || []).map(({ name, value }) => [name.toLowerCase(), value]))
        const body = data.payload?.body?.data ? Buffer.from(data.payload.body.data, 'base64url').toString('utf8') : ''
        return { id, subject: headers.subject || '', sender: headers.from || '', receivedAt: headers.date || null, body }
      }))
    },
    revokeConnection: async ({ token }) => {
      if (!token) return { status: 'disconnected' }
      await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
      return { status: 'disconnected' }
    },
  }
}