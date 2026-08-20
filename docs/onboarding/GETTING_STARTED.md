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

The local Fastify API binds to `127.0.0.1:8787`. Vite normally uses port 5173, but may select another client port when occupied; use its emitted URL. The configured client/API relationship does not automatically follow an arbitrary API port change, so do not change port 8787 without an approved configuration update.

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

1. [Product](../product/PRODUCT.md), [roadmap](../product/ROADMAP.md), and [product decisions](../product/PRODUCT_DECISIONS.md)
2. [Active FEATURE-001 specification](../product/features/FEATURE-001.md)
3. [Architecture](../engineering/ARCHITECTURE.md) and [technical decisions](../engineering/TECH_DECISIONS.md)
4. [UX principles](../design/UX_PRINCIPLES.md), [design system](../design/DESIGN_SYSTEM.md), and [design decisions](../design/DESIGN_DECISIONS.md)
5. [Delivery process](../process/DELIVERY_PROCESS.md), [Ready](../process/DEFINITION_OF_READY.md), and [Done](../process/DEFINITION_OF_DONE.md)
6. [Test strategy](../quality/TEST_STRATEGY.md) and [contribution guide](../../CONTRIBUTING.md)
7. [Development](../engineering/DEVELOPMENT.md), [engineering tests](../engineering/TESTING.md), [security](../engineering/SECURITY.md), [deployment](../engineering/DEPLOYMENT.md), and [migrations](../engineering/MIGRATIONS.md)
8. [AI usage policy](../ai/AI_USAGE_POLICY.md) and the role contract assigned by the Coordinator in [roles](../ai/roles/)
9. [Onboarding simulation](../quality/ONBOARDING_SIMULATION.md)

The tracked onboarding simulation is [GitHub Issue #8](https://github.com/kjs8806/subscription_app/issues/8). It is currently **Blocked**, not Ready or eligible for implementation, until its issue record supplies the required draft PR exact commit, CI evidence, and canonical links. Always inspect the live issue status before acting.

## First contribution

1. Ask the Coordinator to designate and link an actual small issue whose live lifecycle status satisfies Ready. [Issue #8](https://github.com/kjs8806/subscription_app/issues/8) tracks the simulation itself and is currently Blocked; it is not an eligible onboarding implementation task.
2. Inspect a Coordinator-linked completed or supervised issue → specification → PR → CI → QA chain. Onboarding verification remains blocked until a real example is supplied.
3. Create a short-lived branch and follow the linked approved plan.
4. Open a PR using the repository template; do not push directly to `main`.
5. Ask the relevant role owner to review the first contribution.
6. Report missing or stale onboarding information to the Coordinator.

See [PROJECT_GLOSSARY.md](PROJECT_GLOSSARY.md) for shared terminology.
