# Contributing to Subtle AI

GitHub is the durable source of truth. Read [Getting Started](docs/onboarding/GETTING_STARTED.md), [Development](docs/engineering/DEVELOPMENT.md), [Engineering Testing](docs/engineering/TESTING.md), the [Delivery Process](docs/process/DELIVERY_PROCESS.md), [Definition of Ready](docs/process/DEFINITION_OF_READY.md), [Definition of Done](docs/process/DEFINITION_OF_DONE.md), [AI Usage Policy](docs/ai/AI_USAGE_POLICY.md), [Security](docs/engineering/SECURITY.md), [Migration Rules](docs/engineering/MIGRATIONS.md), the [ADR index](docs/engineering/adr/README.md), and [Test Strategy](docs/quality/TEST_STRATEGY.md).

## Before development

1. Start from a GitHub issue with a feature ID when applicable.
2. Confirm the issue satisfies the Definition of Ready: approved product criteria, affected UX, technical plan/decisions, and QA testability.
3. Read relevant product, design, architecture, security, migration, ADR, and feature documents.
4. Create a short-lived branch:
   - `feature/FEATURE-XXX-short-name`
   - `fix/FEATURE-XXX-short-name`
   - `chore/short-name`

Do not start integrations blocked by `docs/engineering/TECH_DECISIONS.md`. Automation and AI identities may not push to `main`, merge, release, deploy, or bypass required checks.

## Role boundaries

- Product Owner owns what, why, priority, scope, and acceptance criteria.
- Designer owns user experience and UX review.
- Tech Lead sub-agent owns architecture, technical plans/instructions, and technical review.
- Codex implements the approved plan and records self-checks.
- QA independently validates criteria, regressions, and release quality.
- Coordinator tracks and routes work; it does not replace specialist authority.

See [role contracts](docs/ai/roles/) and the [Coordinator runbook](docs/ai/COORDINATOR_RUNBOOK.md).

## Implementation

- Make the smallest focused change and preserve existing user work.
- Preserve stable subscription IDs and evidence traceability.
- Keep facts, inferences, and recommendations distinct.
- Keep credentials, tokens, personal data, and long-lived secrets out of browser code, logs, and Git.
- Add or update tests and documentation for changed behavior.
- Return any product, UX, or architectural deviation to its owner before proceeding.

## Validation

```sh
npm test
npm run build
git diff --check
```

Run the narrowest relevant test first. User-facing changes also require applicable loading, empty, error, success, responsive, accessibility, and regression evidence.

## Pull requests

Use the PR template. Link the issue/specification/plan, provide an acceptance-criteria matrix or QA-report link, describe risk and security impact, and record exact validation results. Prefer short-lived, reviewable PRs and squash merge unless individual commits have lasting value.

A PR must not merge until required CI passes, Tech Lead findings are resolved, independent QA approves the exact commit, affected product/design approvals are recorded, and the Definition of Done is satisfied. Security-sensitive, high-risk, or major architecture changes require an additional qualified or Founder-directed review.
