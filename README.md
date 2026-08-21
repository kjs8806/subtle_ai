# Subtle AI

Subtle AI is **your AI subscription optimizer**: a responsive Vite/JavaScript PWA prototype that helps users understand recurring expenses and decide what to do next.

## Start here

- [Getting started](docs/onboarding/GETTING_STARTED.md)
- [Product and current milestone](docs/product/PRODUCT.md)
- [Roadmap](docs/product/ROADMAP.md)
- [Architecture](docs/engineering/ARCHITECTURE.md)
- [Technical decisions](docs/engineering/TECH_DECISIONS.md)
- [Development](docs/engineering/DEVELOPMENT.md)
- [Engineering testing](docs/engineering/TESTING.md)
- [Security](docs/engineering/SECURITY.md)
- [Deployment](docs/engineering/DEPLOYMENT.md)
- [Migrations](docs/engineering/MIGRATIONS.md)
- [Architecture decision records](docs/engineering/adr/README.md)
- [Delivery process](docs/process/DELIVERY_PROCESS.md)
- [Definition of Ready](docs/process/DEFINITION_OF_READY.md) and [Definition of Done](docs/process/DEFINITION_OF_DONE.md)
- [AI usage policy](docs/ai/AI_USAGE_POLICY.md) and [role contracts](docs/ai/roles/)
- [Onboarding simulation](docs/quality/ONBOARDING_SIMULATION.md)
- [Contributing](CONTRIBUTING.md)

## Local development

```sh
npm ci
npm run dev
```

Validate a checkout or change:

```sh
npm test
npm run build
git diff --check
```

## Current implementation

- Vite JavaScript ES-module frontend and installable PWA.
- Deterministic receipt/subscription pipeline with evidence, provenance, confidence, billing, pricing, merging, and recommendations.
- Local Fastify `/api/v1` mock boundary, fake Gmail provider, and in-memory account-scoped persistence.
- PostgreSQL schema and ordered migration runner, with an account-scoped runtime adapter available when configured.
- Server-side AES-256-GCM token custody, explicit provider selection, and Google OIDC/Gmail provider primitives.
- FEATURE-001 mock connection, scanning, discovery, and detail-evidence flow.

Real Gmail acceptance, production secret management/deployment, public data lifecycle, AI provider, bank integration, continuous sync, and background jobs remain release-gated. Do not treat mock behavior or local PostgreSQL as production readiness.

## Documentation map

- Product: [`docs/product/`](docs/product/)
- Design: [`docs/design/`](docs/design/)
- Engineering and ADRs: [`docs/engineering/`](docs/engineering/)
- Quality and release: [`docs/quality/`](docs/quality/)
- Process and gates: [`docs/process/`](docs/process/)
- AI workflow and roles: [`docs/ai/`](docs/ai/)
- Feature specification: [FEATURE-001](docs/product/features/FEATURE-001.md)

GitHub is the durable source of truth. Private conversations may help produce work but do not replace approved repository records.

## Development container

The existing Flutter-oriented devcontainer is legacy/exploratory infrastructure. Flutter is not the current stack; Node 22 and npm are sufficient for this repository.
