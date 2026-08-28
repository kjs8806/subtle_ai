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
    if (!response.ok) {
      // Google's error body (e.g. {"error":"redirect_uri_mismatch",...}) is the
      // only way to tell a redirect_uri mismatch apart from a bad client_secret
      // or a reused/expired code - all three otherwise throw the exact same
      // generic message, making production failures unguessable from logs
      // alone. Safe to include in full: it's Google's response to us, never
      // an echo of anything we sent (the client_secret above never appears in it).
      const body = await response.text().catch(() => '')
      throw new Error(`Google authorization exchange failed: ${response.status} ${body}`)
    }
    return response.json()
  }
  const refresh = async (refreshToken) => {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token' }) })
    if (!response.ok) throw new Error('Google access token refresh failed')
    const tokens = await response.json()
    // Normalize to the same accessToken (camelCase) contract the fake provider's
    // stub uses, which is what callers actually read - Google's raw JSON only has
    // access_token (snake_case), so without this every real scan silently sent
    // "Authorization: Bearer undefined".
    return { ...tokens, accessToken: tokens.access_token }
  }
  const user = async (accessToken) => {
    const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } })
    if (!response.ok) throw new Error(`Google identity lookup failed: ${response.status} ${await response.text().catch(() => '')}`)
    return response.json()
  }
  // A gmail.readonly-only access token carries no OIDC claims, so Google's
  // tokeninfo endpoint returns no `sub`/user-identifying field for it at all -
  // only azp/aud/scope/exp. Gmail's own profile endpoint (already covered by
  // gmail.readonly, no extra scope needed) is the only way to learn which
  // mailbox this token belongs to, via its email address.
  const emailForGmailToken = async (accessToken) => {
    const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${accessToken}` } })
    // Same rationale as exchange() above: a generic message here left the
    // 2026-08-28 "Gmail couldn't be connected" production incident
    // unguessable from logs alone - it could have meant the Gmail API isn't
    // enabled on the project (403), an insufficient/mismatched scope, or a
    // genuine transport failure, and only Google's own response body says
    // which. Safe to log in full: Google's response to us, never an echo of
    // the bearer token we sent.
    if (!response.ok) throw new Error(`Google Gmail identity lookup failed: ${response.status} ${await response.text().catch(() => '')}`)
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
      const identity = await emailForGmailToken(tokens.access_token)
      return { status: 'authorized', email: identity.emailAddress, ...tokens }
    },
    refreshAccessToken: refresh,
    listCandidateMessages: async ({ accessToken }) => {
      const response = await fetchImpl('https://gmail.googleapis.com/gmail/v1/users/me/messages?q=receipt+OR+renewal&maxResults=50', { headers: { authorization: `Bearer ${accessToken}` } })
      if (!response.ok) throw new Error('Gmail message search failed')
      const listing = await response.json()
      const ids = (listing.messages || []).map(({ id }) => id)
      // A real inbox can match far more messages than the mock provider's single
      // canned example ever did, and Gmail's API rate-limits too many concurrent
      // per-user requests - fetch details in small batches rather than firing every
      // lookup at once.
      const BATCH_SIZE = 5
      const results = []
      for (let offset = 0; offset < ids.length; offset += BATCH_SIZE) {
        const batch = await Promise.all(ids.slice(offset, offset + BATCH_SIZE).map(async (id) => {
          const message = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers: { authorization: `Bearer ${accessToken}` } })
          if (!message.ok) throw new Error('Gmail message lookup failed')
          const data = await message.json()
          return adaptGmailMessage(data)
        }))
        results.push(...batch)
      }
      return results
    },
    revokeConnection: async ({ token }) => {
      // A missing/empty token means Google revocation was never attempted, so it
      // can never be treated as verified - that would let an absent or corrupted
      // credential silently count as a successful disconnect. This is a
      // definitive failure: there is no ambiguity about a call that was never made.
      if (!token) return { status: 'revocation_failed' }
      // SEC-041-02: a completed HTTP exchange and a network/transport failure
      // are different outcomes and must not collapse into the same status.
      // A non-2xx response IS Google's actual answer - RFC 7009 requires the
      // revoke endpoint to return 200 even for an already-invalid/expired
      // token, so a genuine non-2xx here is a real, definitive rejection the
      // caller can safely act on (e.g. by reverting a pending-disconnect
      // marker). The token must be sent in the POST body rather than a query
      // string to avoid it landing in access/proxy logs.
      //
      // A thrown exception (DNS failure, connection reset, timeout, an
      // aborted request) is different in kind: the request may never have
      // reached Google, or it may have reached Google and been processed
      // successfully with the response simply lost on the way back. The
      // caller cannot tell which, and must never treat this the same as a
      // confirmed failure (which would license reactivating the connection)
      // or a confirmed success (which would license purging local data).
      try {
        const response = await fetchImpl('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token }),
        })
        if (!response.ok) return { status: 'revocation_failed' }
        return { status: 'disconnected' }
      } catch {
        return { status: 'revocation_ambiguous' }
      }
    },
  }
}