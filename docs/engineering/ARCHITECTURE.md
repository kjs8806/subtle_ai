# Architecture

## Status

This document describes the current implemented prototype. It is not a production target architecture.

## Application

Subtle AI is a Vite-powered JavaScript web application and installable PWA. `index.html` provides the document shell and loads `src/main.js` as an ES module. The browser owns the current application state; there is no server-side runtime.

## Modules

- `src/main.js` bootstraps the prototype dashboard, owns derived UI state, and wires browser events.
- `src/data/demoSubscriptions.js` contains static presentation fixtures for demo subscriptions and the savings action feed. These are not the normalized production subscription-domain entities.
- `src/data/subscriptionModel.js` calculates demo recurring spend and adapts demo records into pipeline records.
- `src/services/receiptPipeline.js` parses receipt-like text and creates plain-object evidence, subscription, billing, price-observation, and recommendation entities.
- `src/style.css` contains the application presentation styles.
- `server/app.js` provides the local Fastify API boundary and mock-provider FEATURE-001 routes; it uses an in-memory repository for development and tests.
- `server/gmail/fakeProvider.js` provides deterministic authorization and scan scenarios. No Google API or Gmail SDK is present.
- `server/persistence/memoryRepository.js` provides account-scoped local persistence for mock validation; PostgreSQL is represented by the migration only.
- `public/sw.js` provides service-worker installation, shell caching, and same-origin runtime caching. `/api/**` requests are network-only.

## Data And Persistence

Seeded data remains hardcoded in the browser bundle. FEATURE-001 mock API state is held in memory and is not production persistence. There is no real Google/Gmail integration, PostgreSQL runtime, continuous synchronization, or background job. Receipt evidence is created deterministically from local demo or fake-provider messages.

## Domain Flow

```text
demo subscription data
    -> receiptPipeline.parseReceipt
    -> Evidence
    -> createSubscriptionRecord
    -> Subscription with billing and price observations
    -> buildRecommendations
```

Recommendations retain both `evidenceIds` and structured evidence references so claims can remain traceable as the model evolves.

## Security Boundaries

There are currently no authenticated or user-specific data boundaries. No provider credentials, OAuth tokens, or AI secrets are present in the client application. A future Gmail or AI integration must not place provider secrets in browser code.

## Testing

The domain pipeline is tested with Node's built-in test runner in `test/receiptPipeline.test.js`. The browser UI currently has no automated interaction test suite.

## Production Readiness

The prototype plus mock FEATURE-001 slice is not yet a production architecture. Real Gmail, PostgreSQL deployment, and public data-lifecycle behavior remain release-gated.

## FEATURE-001 Target Architecture

This section describes the approved target for FEATURE-001. The local mock backend and API shape are implemented; real Google Gmail access and production PostgreSQL deployment are not.

- The existing Vite PWA remains the frontend and continues to support seeded and manual prototype behavior.
- A future Node.js and Fastify backend would expose a same-origin `/api/v1` JSON API.
- Google OIDC would establish application identity; Gmail authorization would be a separate, explicit user action.
- A future PostgreSQL persistence layer would store account-scoped users, identities, sessions, Gmail source connections, scan runs, messages, subscriptions, evidence, billing events, price observations, and field-level provenance.
- The server would issue an opaque `HttpOnly`, `Secure`, `SameSite=Lax` session cookie and would never expose provider refresh tokens to the browser.
- FEATURE-001 scans would be explicit user-triggered operations with no continuous or background synchronization.
- Gmail access would use only the approved read-only scope, with refresh tokens encrypted and stored server-side.
- The deterministic receipt pipeline would remain independent of the backend and database. Server adapters would pass provider messages into its existing contract and persist its output.
- AI recommendations, notifications, and public retention/export/deletion behavior are deferred or remain release gates.

The corresponding FEATURE-001 technical decisions are approved in `TECH_DECISIONS.md`; implementation may proceed within this scope. This does not make any target component current or authorize out-of-scope integrations.