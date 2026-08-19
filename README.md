# Subtle AI

Subtle AI is currently a Vite-powered JavaScript web application and installable PWA prototype. It helps users understand recurring subscription expenses and identify possible savings opportunities.

## Development

Install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

The production build can be generated with:

```sh
npm run build
```

## Current architecture

- `src/main.js` contains the prototype screen, demo data, UI state, rendering, and event handlers.
- `src/services/receiptPipeline.js` contains the first extracted receipt and subscription-domain logic.
- `server/app.js` contains the local Fastify `/api/v1` boundary for the mock FEATURE-001 flow.
- `server/gmail/fakeProvider.js` is the only configured provider; real Gmail access is not enabled.
- `migrations/001_feature_001.sql` defines the planned PostgreSQL schema but is not executed by the local app.
- `test/receiptPipeline.test.js` covers the receipt pipeline and core subscription-domain behaviors with Node's built-in test runner.
- `docs/engineering/ARCHITECTURE.md` describes the implemented prototype architecture.
- `docs/engineering/TECH_DECISIONS.md` tracks unresolved production architecture decisions.
- `public/sw.js` provides the service-worker shell and same-origin runtime caching.
- There is currently no real Gmail integration, PostgreSQL runtime, AI service, or background synchronization. The local backend uses an in-memory repository and mock provider.

## Development container

The existing `.devcontainer/devcontainer.json` is Flutter-oriented and includes the Flutter SDK, Android SDK, and Dart/Flutter extension. Flutter is not the current application stack; the container is retained as legacy or exploratory infrastructure until the project explicitly decides whether to migrate to Flutter or replace it with a Node/Vite-oriented container.

For the current web prototype, the host environment or a Node-enabled development container is sufficient.
