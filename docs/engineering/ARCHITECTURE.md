# Architecture

## Status

This document describes the current implemented prototype. It is not a production target architecture.

## Application

Subtle AI is a Vite-powered JavaScript web application and installable PWA. `index.html` provides the document shell and loads `src/main.js` as an ES module. The browser owns the current application state; there is no server-side runtime.

## Modules

- `src/main.js` renders the prototype dashboard, owns demo UI state, and wires browser events.
- `src/data/subscriptionModel.js` calculates demo recurring spend and adapts demo records into pipeline records.
- `src/services/receiptPipeline.js` parses receipt-like text and creates plain-object evidence, subscription, billing, price-observation, and recommendation entities.
- `src/style.css` contains the application presentation styles.
- `public/sw.js` provides service-worker installation, shell caching, and same-origin runtime caching.

## Data And Persistence

The current data is hardcoded demo data in the browser bundle. There is no authentication, user identity, database, persistence layer, API, Gmail integration, or background synchronization. Receipt evidence is created only from local demo inputs.

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

The prototype is not yet a production architecture. The decisions required before external integrations are tracked in `TECH_DECISIONS.md`.