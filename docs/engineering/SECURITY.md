# Security and Privacy

## Current status

Subtle AI is a prototype with a mock Fastify boundary, fake Gmail provider, in-memory persistence, and a planned PostgreSQL schema. It is not production-ready and must not process real Gmail credentials or production financial data until the release gates below are satisfied.

## Non-negotiable boundaries

- Never place Gmail refresh tokens, provider credentials, AI keys, or long-lived secrets in browser code.
- Never commit secrets, real receipt content, access tokens, or personal data.
- Keep authentication separate from explicit Gmail authorization.
- Scope all persisted records and provider connections to an authenticated account.
- Request the minimum approved Gmail scope.
- Encrypt refresh tokens at rest and restrict decryption capability.
- Avoid sensitive message content in logs, analytics, traces, and error reports.
- Preserve evidence provenance without exposing irrelevant email content.
- Revoke or stop future access when a source is disconnected.

## Required threat model before real Gmail access

Document assets, trust boundaries, actors, abuse cases, mitigations, and residual risk for:

- OAuth callback and account-linking attacks.
- Session theft, fixation, CSRF, and authorization bypass.
- Cross-account data access.
- Token leakage and secret compromise.
- Malicious or malformed email content.
- Duplicate/replayed scans and billing events.
- Sensitive-data exposure through logs, errors, caches, backups, or support tooling.
- Dependency and build-chain compromise.
- Retention, deletion, export, and provider revocation.

## Production release gates

- Real authentication and account isolation.
- Approved OAuth flow, scope, token encryption, rotation, and revocation.
- Approved retention, deletion, export, and consent behavior.
- Secret management and environment separation.
- Security-focused integration tests.
- Audit events that exclude sensitive message bodies.
- Dependency/vulnerability review.
- Monitoring, incident response, and rollback procedure.
- Privacy-policy and consent review.

Security-sensitive decisions must be recorded in TECH_DECISIONS.md or an engineering ADR and receive the approvals stated there.
