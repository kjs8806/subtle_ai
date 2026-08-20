# Getting Started

> **Owner:** Project Coordinator
> **Technical reviewer:** Tech Lead
> **Status:** Onboarding baseline
> **Last reviewed:** 2026-08-20

## Goal

A contributor should be able to clone the repository, run the application and tests, understand the current milestone, and find an eligible task without access to private conversations.

## Prerequisites

- Git
- Node.js 22
- npm

The existing Flutter-oriented devcontainer is legacy/exploratory and is not required for this Vite/Node project.

## Setup

```sh
git clone https://github.com/kjs8806/subscription_app.git
cd subscription_app
npm ci
npm run dev
```

The local command starts Fastify (normally port 8787) and Vite (normally port 5173). Use the URLs emitted by the processes because an occupied port may change the client URL.

## Validate the checkout

```sh
npm test
npm run build
git diff --check
```

For a narrow server-only check:

```sh
npm run test:server
```

## Important local limitations

- `GMAIL_PROVIDER` supports only the configured fake provider; no real Gmail access is enabled.
- API state is in memory and resets when the server restarts.
- `migrations/001_feature_001.sql` is a planned PostgreSQL schema and is not run by the local app.
- No production environment, deployment, real authentication, OAuth token store, AI provider, bank integration, or background job exists.

## Reading order

1. [Product](../product/PRODUCT.md) and [roadmap](../product/ROADMAP.md)
2. [Active FEATURE-001 specification](../product/features/FEATURE-001.md)
3. [Architecture](../engineering/ARCHITECTURE.md) and [technical decisions](../engineering/TECH_DECISIONS.md)
4. [UX principles](../design/UX_PRINCIPLES.md) and [design system](../design/DESIGN_SYSTEM.md)
5. [Delivery process](../process/DELIVERY_PROCESS.md), [Ready](../process/DEFINITION_OF_READY.md), and [Done](../process/DEFINITION_OF_DONE.md)
6. [Test strategy](../quality/TEST_STRATEGY.md) and [contribution guide](../../CONTRIBUTING.md)

## First contribution

1. Select a small, Ready issue from the project tracker.
2. Inspect one completed issue → specification → PR → CI → QA chain.
3. Create a short-lived branch and follow the linked approved plan.
4. Open a PR using the repository template; do not push directly to `main`.
5. Ask the relevant role owner to review the first contribution.
6. Report missing or stale onboarding information to the Coordinator.

See [PROJECT_GLOSSARY.md](PROJECT_GLOSSARY.md) for shared terminology.
