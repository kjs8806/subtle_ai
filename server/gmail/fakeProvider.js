const scenarios = {
  success: [{ id: 'mock-message-netflix-1', subject: 'Netflix renewal receipt', sender: 'billing@netflix.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your monthly payment of $22.99 renews Sep 12, 2026.' }],
  empty: [],
  ambiguous: [{ id: 'mock-message-ambiguous-1', subject: 'Payment receipt', sender: 'billing@example.com', receivedAt: '2026-08-19T09:00:00.000Z', body: 'Your payment was received.' }],
  failure: null,
}

export const createFakeGmailProvider = () => ({
  createAuthorizationRequest: ({ state }) => ({ url: `/api/v1/sources/gmail/callback?state=${encodeURIComponent(state)}&code=mock-success` }),
  exchangeAuthorizationCode: async ({ code }) => {
    if (code === 'mock-cancel') return { status: 'cancelled' }
    if (code === 'mock-error') throw new Error('Mock authorization failed')
    return { status: 'authorized', refreshToken: 'mock-refresh-token' }
  },
  listCandidateMessages: async () => scenarios[process.env.MOCK_GMAIL_SCENARIO || 'success'],
  getMessage: async (message) => message,
  revokeConnection: async () => ({ status: 'disconnected' }),
})
