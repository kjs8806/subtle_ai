// The default scan scenario models a small but varied inbox - one receipt per
// service, each with its own sender domain, price, and renewal date - so a
// fresh mock sign-in has something to show instead of a single Netflix row.
// Each body follows the same "USD $X.XX renews <Month Day, Year>" shape the
// classifier/extractor in src/services/receiptPipeline.js expects (recurring
// language + explicit cadence + a resolvable USD/CAD amount), so every one of
// these lands as a real subscription, not an ambiguous candidate.
const successMessages = [
  { id: 'mock-message-netflix-1', subject: 'Netflix Premium Plan receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-15T09:00:00.000Z', body: 'Your monthly payment of USD $17.99 renews Sep 12, 2026.' },
  { id: 'mock-message-spotify-1', subject: 'Spotify Premium Individual receipt', sender: 'no-reply@spotify.com', receivedAt: '2026-08-16T09:00:00.000Z', body: 'Your monthly payment of USD $10.99 renews Sep 05, 2026.' },
  { id: 'mock-message-dropbox-1', subject: 'Dropbox Plus 2TB receipt', sender: 'billing@dropbox.com', receivedAt: '2026-08-17T09:00:00.000Z', body: 'Your monthly payment of USD $11.99 renews Sep 12, 2026.' },
  { id: 'mock-message-disneyplus-1', subject: 'Disney+ Premium receipt', sender: 'billing@disneyplus.com', receivedAt: '2026-08-18T09:00:00.000Z', body: 'Your monthly payment of USD $13.99 renews Sep 30, 2026.' },
  { id: 'mock-message-youtube-1', subject: 'YouTube Premium receipt', sender: 'payments@youtube.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of USD $13.99 renews Oct 02, 2026.' },
  { id: 'mock-message-chatgpt-1', subject: 'ChatGPT Plus receipt', sender: 'billing@openai.com', receivedAt: '2026-08-20T09:00:00.000Z', body: 'Your monthly payment of USD $20.00 renews Sep 15, 2026.' },
]

const scenarios = {
  success: successMessages,
  empty: [],
  ambiguous: [{ id: 'mock-message-ambiguous-1', subject: 'Payment receipt', sender: 'billing@example.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your payment was received.' }],
  failure: null,
}

export const createFakeGmailProvider = () => ({
  createAuthorizationRequest: ({ state }) => ({ url: `/api/v1/auth/google/callback?state=${encodeURIComponent(state)}&code=mock-success` }),
  createGmailAuthorizationRequest: ({ state }) => ({ url: `/api/v1/sources/gmail/callback?state=${encodeURIComponent(state)}&code=mock-success` }),
  exchangeAuthorizationCode: async ({ code }) => {
    if (code === 'mock-cancel') return { status: 'cancelled' }
    if (code === 'mock-error') throw new Error('Mock authorization failed')
    return { status: 'authorized', refreshToken: 'mock-refresh-token' }
  },
  exchangeGmailAuthorizationCode: async ({ code }) => ({ status: code === 'mock-cancel' ? 'cancelled' : 'authorized', refreshToken: 'mock-refresh-token' }),
  listCandidateMessages: async () => scenarios[process.env.MOCK_GMAIL_SCENARIO || 'success'],
  getMessage: async (message) => message,
  refreshAccessToken: async () => ({ accessToken: 'mock-access-token' }),
  revokeConnection: async () => ({ status: 'disconnected' }),
})
