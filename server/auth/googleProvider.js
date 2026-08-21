import { adaptGmailMessage } from '../gmail/messageAdapter.js'

const required = (value, name) => {
  if (!value) throw new Error(`${name} is required`)
  return value
}

export const createGoogleProvider = ({ clientId, clientSecret, oidcRedirectUri, gmailRedirectUri, fetchImpl = fetch }) => {
  required(clientId, 'GOOGLE_CLIENT_ID')
  required(clientSecret, 'GOOGLE_CLIENT_SECRET')
  required(oidcRedirectUri, 'GOOGLE_OIDC_REDIRECT_URI')
  required(gmailRedirectUri, 'GOOGLE_GMAIL_REDIRECT_URI')
  const authorization = (scope, state, redirectUri) => {
    const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope, state, access_type: 'offline', prompt: 'consent' })
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }
  const exchange = async (code, redirectUri) => {
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
  const subjectForGmailToken = async (accessToken) => {
    const response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`)
    if (!response.ok) throw new Error('Google Gmail identity lookup failed')
    return response.json()
  }
  const start = ({ state, scope, redirectUri }) => ({ url: authorization(scope, state, redirectUri) })
  return {
    createAuthorizationRequest: ({ state }) => start({ state, scope: 'openid email profile', redirectUri: oidcRedirectUri }),
    exchangeAuthorizationCode: async ({ code }) => {
      const tokens = await exchange(code, oidcRedirectUri)
      const identity = await user(tokens.access_token)
      return { status: 'authorized', subject: identity.sub, email: identity.email, name: identity.name, ...tokens }
    },
    createGmailAuthorizationRequest: ({ state }) => start({ state, scope: 'https://www.googleapis.com/auth/gmail.readonly', redirectUri: gmailRedirectUri }),
    exchangeGmailAuthorizationCode: async ({ code }) => {
      const tokens = await exchange(code, gmailRedirectUri)
      const identity = await subjectForGmailToken(tokens.access_token)
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
        return adaptGmailMessage(data)
      }))
    },
    revokeConnection: async ({ token }) => {
      if (!token) return { status: 'disconnected' }
      await fetchImpl(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' })
      return { status: 'disconnected' }
    },
  }
}