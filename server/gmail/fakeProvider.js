// The default scan scenario models a small but varied inbox - one receipt per
// service, each with its own sender domain, price, and renewal date - so a
// fresh mock sign-in has something to show instead of a single Netflix row.
// Most bodies follow the same "USD $X.XX renews <Month Day, Year>" shape the
// classifier/extractor in src/services/receiptPipeline.js expects (recurring
// language + explicit cadence + a resolvable USD/CAD amount), so those land
// as real subscriptions, not ambiguous candidates. A few messages are
// deliberately weaker signal (see below) so that connecting Gmail also
// exercises the "Needs a decision" recommendation engine and the "Needs your
// review" ambiguous-candidate flow, not just a clean subscription list.
const successMessages = [
  { id: 'mock-message-netflix-1', subject: 'Netflix Premium Plan receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-15T09:00:00.000Z', body: 'Your monthly payment of USD $17.99 renews Sep 12, 2026.' },
  { id: 'mock-message-spotify-1', subject: 'Spotify Premium Individual receipt', sender: 'no-reply@spotify.com', receivedAt: '2026-08-16T09:00:00.000Z', body: 'Your monthly payment of USD $10.99 renews Sep 05, 2026.' },
  { id: 'mock-message-dropbox-1', subject: 'Dropbox Plus 2TB receipt', sender: 'billing@dropbox.com', receivedAt: '2026-08-17T09:00:00.000Z', body: 'Your monthly payment of USD $11.99 renews Sep 12, 2026.' },
  // Disney+ and YouTube Premium are both entertainment-streaming templates
  // (see OVERLAP_PAIRS in src/services/receiptPipeline.js) - subscribing to
  // both is exactly the "possible overlap" recommendation scenario.
  { id: 'mock-message-disneyplus-1', subject: 'Disney+ Premium receipt', sender: 'billing@disneyplus.com', receivedAt: '2026-08-18T09:00:00.000Z', body: 'Your monthly payment of USD $13.99 renews Sep 30, 2026.' },
  { id: 'mock-message-youtube-1', subject: 'YouTube Premium receipt', sender: 'payments@youtube.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of USD $13.99 renews Oct 02, 2026.' },
  // Two receipts for the same ChatGPT Plus subscription, at different prices
  // and dates, so it accumulates a two-point price history and triggers
  // detectPriceChange's "price increase" recommendation on scan.
  { id: 'mock-message-chatgpt-0', subject: 'ChatGPT Plus receipt', sender: 'billing@openai.com', receivedAt: '2026-07-15T09:00:00.000Z', body: 'Your monthly payment of USD $16.00 renews Aug 15, 2026.' },
  { id: 'mock-message-chatgpt-1', subject: 'ChatGPT Plus receipt', sender: 'billing@openai.com', receivedAt: '2026-08-20T09:00:00.000Z', body: 'Your monthly payment of USD $20.00 renews Sep 15, 2026.' },
  // Weak-signal receipts: a known-service template match (+3) alone, with no
  // recurring/cadence/membership language, scores below the subscription
  // threshold (5) and lands as an ambiguous pending candidate instead - see
  // classifySubscriptionCandidate in src/services/subscriptionClassifier.js.
  { id: 'mock-message-icloud-1', subject: 'Your receipt from Apple', sender: '"Apple" <payments@apple.com>', receivedAt: '2026-08-21T09:00:00.000Z', body: 'Your payment of USD $2.99 was processed for iCloud+ storage.' },
  { id: 'mock-message-ms365-1', subject: 'Your Microsoft 365 receipt', sender: '"Microsoft" <billing@microsoft.com>', receivedAt: '2026-08-21T10:00:00.000Z', body: 'Your payment of CAD $6.99 was processed for Microsoft 365.' },
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
