# Testing Strategy

## Current automated gates

The project uses Node's built-in test runner and the Vite production build.

Required for every pull request:

- npm test
- npm run build
- git diff --check

CI runs these checks automatically.

## Test layers

- Domain unit tests: receipt parsing, normalization, evidence, confidence, price observations, recommendations, and merging.
- API/integration tests: account scoping, authorization state, scan outcomes, idempotency, retries, and error contracts.
- UI tests: connection states, navigation, Subscription Detail ID consistency, provenance, loading, empty, error, success, responsive, and accessibility behavior.
- End-to-end tests before real Gmail rollout: authorization callback, supported receipt discovery, persistence, duplicate prevention, detail evidence, disconnect, and failure recovery.
- Security tests: cross-account access, CSRF/session controls, callback validation, secret exposure, malformed provider data, and log redaction.

## Acceptance-criteria traceability

Every user-facing PR must map applicable acceptance criteria to automated tests or recorded manual QA. A passing unit suite alone is not product acceptance.

## Independent QA

QA reviews after CI and technical self-review. QA records environment, commit, scenarios, results, evidence, defects, regression coverage, and release recommendation. Product or UX ambiguity returns to the appropriate owner rather than being guessed.

## Known gaps

The browser UI currently lacks an automated interaction suite. Real Gmail, PostgreSQL runtime, staging, and production end-to-end coverage remain release-gated.

The repository also lacks an explicit lint/static-analysis and code-formatting gate; `git diff --check` covers whitespace only. Adding and enforcing those tools in CI is planned.

A dependency-review workflow is also planned, but it must not be enabled until support for this private repository is confirmed. Dependabot remains enabled for npm and GitHub Actions dependency updates.
