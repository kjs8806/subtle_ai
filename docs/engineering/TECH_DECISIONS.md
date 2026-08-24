# Technical Decisions

This register records production architecture decisions and remaining release gates. FEATURE-001's technical decisions were approved by the project owner on 2026-08-19.

## FEATURE-001 Approved Decisions

These decisions authorize implementation of the FEATURE-001 vertical slice within the stated scope. They do not authorize AI recommendations, continuous synchronization, notifications, multiple Gmail accounts, or unrelated production integrations.

### Identity And Authorization

- Use Google OIDC identity for FEATURE-001.
- Keep authentication and Gmail authorization as separate flows.
- Request only `openid`, `email`, and `profile` during sign-in; Gmail authorization is not part of sign-in.
- Use an opaque server session sent only through an `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- Store only a hash of the session token server-side.

### Backend And Persistence

- Use Node.js with Fastify for the future backend.
- Expose a same-origin `/api/v1` JSON API.
- Use PostgreSQL for account-scoped persistence.
- Assign stable persisted subscription IDs at the persistence/resolution boundary, not from Gmail message IDs or canonical merchant names alone.
- Keep persistence adapters outside `src/services/receiptPipeline.js`.

### Gmail And Scanning

- Request only `https://www.googleapis.com/auth/gmail.readonly` for Gmail access.
- Store Gmail refresh tokens only on the server and encrypt them at rest.
- Do not add continuous or background synchronization to FEATURE-001.
- Make scans explicit user-triggered operations.

### Deferred And Release-Gated Work

- AI extraction and recommendations are deferred.
- Notifications are deferred.
- A full public retention, export, and deletion policy remains a public-release gate. Account deletion and the corrected Gmail-disconnect purge are approved and implemented under MVP-BETA-004 below; export is not.

## MVP-BETA-004 Approved Decisions (#41)

Account & Data Controls: Disconnect Gmail vs. Delete Account, and the public-beta retention/deletion policy. Approved by the Product Owner on issue #41 ([comment](https://github.com/kjs8806/subtle_ai/issues/41#issuecomment-5391360702)); implemented on branch `claude/account-data-controls`.

### Retention And Deletion Policy

- Disconnecting Gmail revokes the stored OAuth/refresh credential, purges every Gmail-derived record (evidence, subscriptions, corrections, ambiguous candidates - confirmed and pending alike, price-change events, attention-item dismissals), and preserves the Subtle AI account, auth identity, and session.
- Deleting the account is the full-deletion action: every user-scoped record, including the user and auth-identity rows themselves, is removed; the account can no longer be signed into, and re-authenticating with the same provider identity creates a new account rather than resurrecting the deleted one.
- User-facing access to deleted data ceases immediately (both operations complete synchronously, in one transaction on PostgreSQL); no separate 24-hour deletion job exists because none is needed at current beta scale.
- Backups and analytics: this repository has neither a backup pipeline nor an analytics system to purge from (`#47` has not yet introduced analytics) - the approved policy's backup/analytics retention limits are recorded as an integration point for whichever system introduces them, not implemented here as dead code.

### Implementation

- Ownership for both operations comes exclusively from the authenticated session (`request.user.id`); neither endpoint accepts or reads any client-supplied account identifier.
- `DELETE /api/v1/account` performs a best-effort Gmail token revocation (logged, never blocking) then `repository.deleteAccount`, then revokes every session belonging to that user (`sessions.revokeAllForUser` - the session store is authoritative regardless of `PERSISTENCE_PROVIDER`, so repository deletion alone would not end a live session).
- On PostgreSQL, `deleteAccount` is a single `DELETE FROM users`, relying on `ON DELETE CASCADE` verified table-by-table (not assumed) to reach every dependent row in one atomic statement.
- Migration 012 fixes a pre-existing bug found during that verification: `subscription_candidates.resolved_subscription_id` had no `ON DELETE` behavior, so deleting a subscription a confirmed candidate resolved to - exactly what Gmail disconnect already did - threw a foreign key violation and rolled back the whole disconnect for any user who had ever confirmed a candidate. Reproduced against a real database before the fix, and covered by a regression test after it.
- `disconnectConnection` is a surgical purge (the account is not being deleted), so it explicitly deletes every Gmail-derived table rather than relying on cascade from `users`.
- The in-memory backend has no FK/cascade safety net at all; both operations were audited table-by-table there too and covered by the same contract test suite that runs against PostgreSQL, so both backends are held to identical guarantees.

## Remaining Broader Release Decisions

The following questions remain open outside the approved FEATURE-001 implementation scope.

### Authentication And User Accounts

- **Status:** Authentication resolved by FEATURE-001 (Google OIDC); account deletion resolved by MVP-BETA-004 above. Open: any authentication method beyond Google OIDC.
- **Question:** How will users authenticate, and how will account ownership and deletion be represented?
- **Owner:** Tech Lead with Founder approval
- **Constraint:** User data must be isolated by account before Gmail evidence or persistence is introduced.

### Backend And API

- **Status:** Open beyond FEATURE-001
- **Question:** What server runtime and API boundary will own authenticated operations, provider callbacks, recommendation generation, and synchronization jobs?
- **Owner:** Tech Lead
- **Constraint:** Browser code must not receive long-lived provider credentials or AI secrets.

### Persistent Database

- **Status:** Open beyond FEATURE-001
- **Question:** Which database and schema will store users, data-source connections, evidence, subscriptions, billing events, price observations, recommendations, and audit metadata?
- **Owner:** Tech Lead
- **Constraint:** Recommendation evidence links must remain durable and queryable.

### Gmail Integration

- **Status:** Open beyond FEATURE-001
- **Question:** What Gmail permission scope, OAuth flow, token storage, sync cadence, revocation flow, and retention policy will be used?
- **Owner:** Tech Lead with Founder approval
- **Constraint:** Request the minimum permission scope and keep refresh tokens server-side.

### AI Extraction And Recommendations

- **Status:** Deferred beyond FEATURE-001
- **Question:** Which extraction and recommendation responsibilities, if any, should use AI, and how will outputs be validated against receipt evidence?
- **Owner:** Tech Lead with Product Owner approval
- **Constraint:** AI output cannot become an unsupported financial claim; every recommendation must retain evidence and confidence metadata.

### Background Synchronization

- **Status:** Deferred beyond FEATURE-001
- **Question:** Where will scheduled Gmail synchronization run, how will retries and idempotency work, and how will partial failures be surfaced?
- **Owner:** Tech Lead
- **Constraint:** Sync jobs must be idempotent and observable before production use.

### Notifications

- **Status:** Open
- **Question:** Which notification channels and user consent model will support renewal or price-change alerts?
- **Owner:** Product Owner and Tech Lead
- **Constraint:** Notifications require explicit consent, unsubscribe behavior, and a reliable source timestamp.

## Decision Rule

For FEATURE-001, implementation may proceed using the approved decisions above. Keep AI providers, notifications, continuous/background synchronization, and other out-of-scope integrations deferred. Do not expand beyond FEATURE-001 without a new approved decision.