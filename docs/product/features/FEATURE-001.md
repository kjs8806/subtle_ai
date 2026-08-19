# FEATURE-001 — Evidence-Backed Gmail Receipt Ingestion Vertical Slice

## Status

- Product: **PRODUCT DEFINED**
- Design: **DESIGN READY**
- Lifecycle: **DESIGN READY**
- Priority: **P0 — Next milestone**
- Next owner: **Tech Lead**
- Founder decision required now: **None**

## Objective

Prove Subtle AI's evidence-backed discovery model through this end-to-end test:

> Connect Gmail → discover a real receipt → create one evidence-backed subscription → open it → inspect matching evidence in Subscription Detail.

Trustworthy discovery comes before AI recommendations or broad production coverage.

## Problem and user value

The prototype currently uses seeded browser data and manual entry. It cannot prove automatic discovery using a user's real recurring expenses. This slice lets a user intentionally connect Gmail, review an automatically discovered subscription, and understand why Subtle AI believes it exists.

## User story

As a user, I want to securely connect Gmail and have Subtle AI discover a subscription from a real receipt, so that I can review the created record and verify its supporting evidence.

## Scope

- Explicit user-initiated Gmail connection with plain-language disclosure.
- Discovery of at least one supported real subscription receipt.
- Evidence and extracted data attached to a stable subscription ID.
- Confirmed facts and inferred values clearly distinguished.
- Confidence metadata for inferred information.
- Duplicate prevention when the same receipt is processed again.
- Multiple receipts for one subscription merged into one record when evidence supports it.
- Discovered record displayed in the existing list and Subscription Detail.
- Matching receipt evidence visible from Subscription Detail.
- Scanning, success, no-result, ambiguous-message, cancellation, and failure outcomes.
- User-controlled Gmail disconnect.
- Limited internal/test-cohort validation.
- Existing seeded and manual prototype behavior remains usable.

## Out of scope

- Public production rollout or universal receipt support.
- Multiple Gmail accounts per user.
- Continuous background monitoring, notifications, or background jobs.
- Bank integrations.
- AI-generated recommendations or general-purpose AI integration.
- Cancellation, switching, negotiation, or purchases.
- Chat as the primary interaction.
- Historical reconstruction beyond processed receipts.
- Final public retention, deletion, export, and account-removal policy.
- Backend, database, OAuth, API, deployment, and token-storage technology choices.

## Product requirements

1. Discovery begins only after explicit user action.
2. Before Google authorization, explain why access is requested, what receipt information may create records, and that Gmail can be disconnected.
3. Never show Gmail as connected before authorization succeeds.
4. Keep authorization state distinct from receipt-scanning state.
5. Clearly communicate discovery, no-result, ambiguous-message, and failure outcomes.
6. Every discovered record has a stable subscription ID. Evidence, history, confidence, and future recommendations resolve through that ID.
7. Preserve supported canonical service, raw merchant, plan, current price, billing cycle, next renewal, status, source, confidence, observations, billing events, and evidence.
8. Missing information remains missing or is explicitly inferred. Never manufacture values.
9. Sufficient evidence identifying a subscription and charge may create a record even when optional plan or renewal data is absent.
10. Distinguish evidence facts, analysis inferences, and recommendations.
11. Show enough relevant receipt context to explain the record without treating irrelevant or sensitive content as necessary evidence.
12. Reprocessing a receipt creates neither a duplicate subscription nor duplicate billing event.
13. Later receipts for the same subscription enrich one record unless evidence supports separate subscriptions.
14. The discovered record appears consistently in list, detail, and spending totals when price and cadence are sufficiently known.
15. Subscription Detail displays only data belonging to the selected subscription ID.
16. Low-confidence detections are not presented as confirmed; insufficient evidence must not create a confident record.
17. Disconnecting stops future Gmail discovery. Retention/deletion behavior must be resolved before public release.
18. This milestone succeeds without a savings recommendation.

## UX specification

### Objective and entry points

The experience follows: **Connect source → discover receipt → review subscription → verify evidence**.

Primary entry: **Overview → Data sources → Connect Gmail**. A contextual Connect Gmail action may appear near subscription empty states while manual entry remains available. No new navigation tab is required.

### User flow

1. Connect Gmail opens an in-app disclosure.
2. The disclosure states what Subtle AI looks for, why access is requested, and that Gmail has not yet been accessed. Actions: **Continue to Gmail** and **Not now**.
3. Continue to Gmail launches external Google authorization.
4. Success starts scanning; cancellation returns to disconnected; failure shows recovery.
5. During scanning, Gmail reads **Scanning receipts** and navigation remains available.
6. A result displays **1 subscription found**, adds the normal list row, and offers **Review subscription**.
7. Review opens Subscription Detail by the discovered subscription ID.
8. No-result messaging says no qualifying receipts were found, not that the user has no subscriptions.

### Data-source states

- Disconnected: **Not connected**, action **Connect**
- Authorizing: **Waiting for Gmail**
- Syncing: **Scanning receipts**
- Connected: **Connected**, with real last-scan data when available
- Reconnect required: **Reconnect needed**
- Sync error: connection state and scanning failure shown separately

Do not fabricate progress, counts, values, or timestamps.

### Subscription Detail provenance

Preserve the current hierarchy and standardize these labels:

- **Confirmed from receipt** — directly supported fact
- **Inferred from receipt** — analyzed but not directly confirmed
- **Recommendation** — advice based on identified evidence/inferences

Confidence complements provenance; it does not replace it. Recommendations never appear as receipt facts.

### States

- Loading: Opening Gmail disables duplicate activation; scanning is non-blocking and indeterminate unless real progress exists.
- Empty: No subscription receipts found; explain that no qualifying receipt could confidently become a record; retain manual entry.
- Cancelled: return to Not connected with neutral feedback.
- Authorization error: We couldn't connect Gmail, with Try again.
- Scan error: Gmail is connected, but receipts couldn't be scanned, with retry.
- Expired permission: Reconnect needed, with Reconnect Gmail.
- Processing failure: create no broken subscription row.
- Success: culminates in reviewing matching subscription evidence, not merely celebrating connection.

### Responsive and accessibility requirements

- Desktop uses a centered disclosure modal; mobile uses a full-width sheet or near-full-screen dialog.
- Mobile Subscription Detail is scrollable with no horizontal scrolling.
- Minimum touch target is 44 × 44 CSS pixels.
- Use semantic buttons, accessible dialog naming, focus trap, Escape dismissal, and focus restoration.
- Announce state changes through an appropriate live region.
- Do not rely on color alone for state, confidence, or provenance.
- Support keyboard operation, visible focus, semantic headings, sufficient contrast, associated errors, and reduced motion.

### Design-system impact

Document reusable source states, external-authorization disclosure, non-blocking processing, discovery success, provenance, and confidence patterns. Preserve the existing visual language. All new visible branding and document titles must use centralized APP_CONFIG.name.

## Acceptance criteria

1. Gmail remains disconnected until authorization succeeds.
2. Connect Gmail first opens the disclosure; cancellation changes no state.
3. The interface never claims connected, scanned, or successful state prematurely.
4. The app remains navigable during scanning and shows no fabricated progress.
5. One supported receipt creates exactly one stable record and one matching billing event.
6. Supported facts are preserved; inferred values are labeled; missing optional values are not invented.
7. Reprocessing the receipt creates no duplicate; a later receipt enriches the same record.
8. Every entry point opens the same ID-backed Subscription Detail.
9. Detail shows only the selected subscription's identity, pricing, history, evidence, confidence, and related data.
10. Matching Gmail evidence is inspectable from Subscription Detail.
11. Facts, inferences, and recommendations are visually and semantically distinct.
12. Spending totals include the record only when price and cadence are sufficiently known.
13. No-result, cancellation, authorization failure, scan failure, and expired permission are distinct.
14. Ambiguous messages do not create confirmed subscriptions.
15. Disconnect stops future discovery until reconnection.
16. Existing seeded/manual subscriptions and Overview, Subscriptions, Savings, Savings Feed, and detail interactions remain intact.
17. The flow supports keyboard and assistive technology and has no mobile horizontal scrolling.
18. New branding resolves through APP_CONFIG.name.
19. The complete meaningful test passes: **Connect Gmail → discover receipt → create evidence-backed subscription → open it → inspect matching evidence.**

## Tech Lead decisions required before implementation

Read docs/engineering/ARCHITECTURE.md and docs/engineering/TECH_DECISIONS.md, then decide:

1. Authentication and account ownership.
2. Backend runtime and API contract.
3. Database schema and evidence retention.
4. Gmail OAuth scope and secure token storage.
5. Sync idempotency, retries, and partial failures.
6. Secret management and deployment.
7. Security controls.
8. Testing strategy and migration impact.
9. Implementation sequencing.
10. Precise GitHub Copilot instructions.

Never place refresh tokens, provider credentials, AI keys, or long-lived secrets in browser code. Preserve the Vite PWA and deterministic receipt pipeline. Do not begin production Gmail integration until the technical decision register is updated and approved.

## Open follow-up questions before public release

- Evidence-retention duration.
- Whether disconnect retains imported records by default.
- Deletion and export policy.
- Initial supported merchants, formats, regions, languages, and currencies.
- Confidence threshold and ambiguous-detection review workflow.
- Broader-rollout success metrics.
- Final consent copy after OAuth scope approval.

## Tech Lead handoff

Using this approved product and UX specification, define the unresolved technical decisions, testing strategy, migration impact, implementation sequence, and precise Copilot instructions. End with **Technical Status: TECHNICAL READY** only when every blocking decision is resolved.
