# Architecture

> **Owner:** Tech Lead  
> **Status:** Current prototype plus explicitly labeled FEATURE-001 target  
> **Last reviewed:** 2026-08-20

## Current implemented system

Subtle AI is a Vite JavaScript ES-module web application and installable PWA. `index.html` loads `src/main.js`; the browser owns prototype UI state and seeded/manual data.

The repository also contains a **local mock backend**:

- `server/app.js`: Fastify `/api/v1` boundary and mock FEATURE-001 routes.
- `server/gmail/fakeProvider.js`: deterministic authorization/scan scenarios; no Google API call.
- `server/persistence/memoryRepository.js`: account-scoped in-memory state that resets on restart.
- `migrations/001_feature_001.sql`: planned PostgreSQL schema, not executed by the local app.

The presence of server code does not mean a production backend, identity system, Gmail integration, token store, or database runtime exists.

## Frontend and domain modules

- `src/main.js`: dashboard bootstrap, derived UI state, rendering, and events.
- `src/data/demoSubscriptions.js`: presentation fixtures; not normalized production entities.
- `src/data/subscriptionModel.js`: recurring-spend calculation and demo-to-pipeline adapter.
- `src/services/receiptPipeline.js`: deterministic parsing, normalization, evidence, subscription, billing, price observation, merging, and recommendation logic.
- `src/services/feature001Api.js`: browser adapter for the local `/api/v1` mock flow.
- `src/style.css`: current presentation system.
- `public/sw.js`: shell/runtime cache; `/api/**` is network-only.

## Current data flow

```text
seeded subscription or fake provider message
  → receiptPipeline.parseReceipt
  → evidence and field provenance
  → stable subscription record
  → billing/price observations
  → deterministic recommendations where supported
  → ID-backed list and Subscription Detail
```

Recommendations retain evidence IDs and related subscription IDs. Facts, inferences, and recommendations remain distinct.

## Security boundary

The mock flow has no production identity or user-data boundary. No provider refresh token, credential, or AI secret may enter browser code. API requests are network-only in the service worker. See [SECURITY.md](SECURITY.md).

## FEATURE-001 approved target — not current implementation

Within the approved FEATURE-001 scope:

- Preserve the Vite PWA and deterministic receipt pipeline.
- Use a Node.js/Fastify same-origin `/api/v1` backend boundary.
- Establish application identity separately from explicit Gmail authorization.
- Issue opaque secure server-managed sessions.
- Store provider refresh tokens encrypted and server-side only.
- Use least-privilege read-only Gmail access.
- Persist account-scoped source connections, scans, messages, subscriptions, evidence, billing, price, and provenance in PostgreSQL.
- Keep scans explicitly user-triggered; background/continuous sync is deferred.
- Populate the existing ID-backed UI and retain seeded/manual behavior.

The current mock API shape is implemented. Real Google OIDC/Gmail OAuth, secure token rotation/storage, PostgreSQL runtime/deployment, production secrets, public data lifecycle, staging, monitoring, and real-provider end-to-end validation remain incomplete and release-gated.

## Testing and operations

Current automated coverage includes domain, repository, and API tests using Node’s test runner, plus the Vite build. Browser interaction, production-provider, database-runtime, migration-environment, staging, and deployment smoke coverage remain gaps. See [TESTING.md](TESTING.md), [TEST_STRATEGY.md](../quality/TEST_STRATEGY.md), [MIGRATIONS.md](MIGRATIONS.md), and [DEPLOYMENT.md](DEPLOYMENT.md).

Approved technical decisions live in [TECH_DECISIONS.md](TECH_DECISIONS.md) and consequential future decisions use [ADRs](adr/README.md). Target descriptions do not authorize integrations beyond their approved decision and feature scope.
