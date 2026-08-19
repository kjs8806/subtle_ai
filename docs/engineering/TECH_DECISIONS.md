# Technical Decisions

This register records production architecture decisions that are still open. No production integration should be added until the relevant decision has an owner and approval.

## Open Decisions

### Authentication And User Accounts

- **Status:** Open
- **Question:** How will users authenticate, and how will account ownership and deletion be represented?
- **Owner:** Tech Lead with Founder approval
- **Constraint:** User data must be isolated by account before Gmail evidence or persistence is introduced.

### Backend And API

- **Status:** Open
- **Question:** What server runtime and API boundary will own authenticated operations, provider callbacks, recommendation generation, and synchronization jobs?
- **Owner:** Tech Lead
- **Constraint:** Browser code must not receive long-lived provider credentials or AI secrets.

### Persistent Database

- **Status:** Open
- **Question:** Which database and schema will store users, data-source connections, evidence, subscriptions, billing events, price observations, recommendations, and audit metadata?
- **Owner:** Tech Lead
- **Constraint:** Recommendation evidence links must remain durable and queryable.

### Gmail Integration

- **Status:** Open
- **Question:** What Gmail permission scope, OAuth flow, token storage, sync cadence, revocation flow, and retention policy will be used?
- **Owner:** Tech Lead with Founder approval
- **Constraint:** Request the minimum permission scope and keep refresh tokens server-side.

### AI Extraction And Recommendations

- **Status:** Open
- **Question:** Which extraction and recommendation responsibilities, if any, should use AI, and how will outputs be validated against receipt evidence?
- **Owner:** Tech Lead with Product Owner approval
- **Constraint:** AI output cannot become an unsupported financial claim; every recommendation must retain evidence and confidence metadata.

### Background Synchronization

- **Status:** Open
- **Question:** Where will scheduled Gmail synchronization run, how will retries and idempotency work, and how will partial failures be surfaced?
- **Owner:** Tech Lead
- **Constraint:** Sync jobs must be idempotent and observable before production use.

### Notifications

- **Status:** Open
- **Question:** Which notification channels and user consent model will support renewal or price-change alerts?
- **Owner:** Product Owner and Tech Lead
- **Constraint:** Notifications require explicit consent, unsubscribe behavior, and a reliable source timestamp.

## Decision Rule

Until these decisions are approved, keep the application local and deterministic. Do not add Gmail OAuth, a backend, a database, AI providers, push notifications, or background jobs to the current prototype.