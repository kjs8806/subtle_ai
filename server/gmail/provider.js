export const createProvider = ({ createAuthorizationRequest, exchangeAuthorizationCode, createGmailAuthorizationRequest, exchangeGmailAuthorizationCode, listCandidateMessages, getMessage, revokeConnection, refreshAccessToken }) => ({
  createAuthorizationRequest,
  exchangeAuthorizationCode,
  createGmailAuthorizationRequest,
  exchangeGmailAuthorizationCode,
  listCandidateMessages,
  getMessage,
  revokeConnection,
  refreshAccessToken,
})
