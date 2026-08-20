# Testing Strategy

## Current automated gates

The project uses Node's built-in test runner and the Vite production build.

Required for every pull request:

- npm test
- npm run build
- git diff --check

CI runs these checks automatically.

## Pull-request commit identities

Specialist review and manual evidence apply to the exact PR head commit. Pull-request CI validates GitHub's synthetic candidate merge for that recorded PR head and base. The CI run summary records the PR head SHA, base SHA, and candidate merge SHA; the PR records those identities and the CI run URL.

Any PR head change invalidates prior specialist review, QA evidence, and CI evidence. The affected checks and reviews must run again against the new head and its new candidate merge.

## Test layers

- Domain unit tests: receipt parsing, normalization, evidence, confidence, price observations, recommendations, and merging.
- API/integration tests: account scoping, authorization state, scan outcomes, idempotency, retries, and error contracts.
- UI tests: connection states, navigation, Subscription Detail ID consistency, provenance, loading, empty, error, success, responsive, and accessibility behavior.
- End-to-end tests before real Gmail rollout: authorization callback, supported receipt discovery, persistence, duplicate prevention, detail evidence, disconnect, and failure recovery.
- Security tests: cross-account access, CSRF/session controls, callback validation, secret exposure, malformed provider data, and log redaction.

## Acceptance-criteria traceability

Every user-facing PR must map applicable acceptance criteria to automated tests or recorded manual QA. A passing unit suite alone is not product acceptance.

## Review sequence and independence

1. Codex records implementation-level self-checks against the approved technical plan.
2. CI runs the required automated gates.
3. The Tech Lead sub-agent reviews architecture, security, maintainability, technical correctness, and testing strategy.
4. Independent QA validates acceptance criteria, regressions, edge cases, and release quality.
5. Security-sensitive, high-risk, or major architectural changes receive an additional qualified review or Founder-directed review.

The Tech Lead is not the only reviewer of an implementation it directed. QA records environment, reviewed PR head, scenarios, results, evidence, defects, regression coverage, and release recommendation. Product or UX ambiguity returns to the appropriate owner rather than being guessed.

## Known gaps

The browser UI currently lacks an automated interaction suite. Real Gmail, PostgreSQL runtime, staging, and production end-to-end coverage remain release-gated.

The repository also lacks an explicit lint/static-analysis and code-formatting gate; `git diff --check` covers whitespace only. Adding and enforcing those tools in CI is planned.

A dependency-review workflow is also planned, but it must not be enabled until support for this private repository is confirmed. Dependabot remains enabled for npm and GitHub Actions dependency updates.
