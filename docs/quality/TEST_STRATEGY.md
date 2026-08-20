# Test Strategy

> **Owner:** QA/Test Engineer
> **Technical contributor:** Tech Lead
> **Status:** Canonical quality policy
> **Last reviewed:** 2026-08-20

`docs/engineering/TESTING.md` describes current implementation-level testing. This document defines independent quality and release evidence.

## Baseline gates

Every PR must run:

```sh
npm ci
npm test
npm run build
git diff --check
```

Required CI and applicable manual evidence must pass on the exact reviewed commit.

## Coverage layers

- Domain unit tests: parsing, normalization, provenance, confidence, merging, price and recommendation rules.
- Repository/persistence tests: account scoping, uniqueness, idempotency, and failure behavior.
- API integration tests: contracts, authorization state, scan results, retries, errors, and isolation.
- Browser/UI tests: flows, stable-ID coherence, responsive states, dialogs, and accessibility.
- End-to-end tests: meaningful user journeys through source, persistence, UI, and evidence.
- Regression tests: seeded/manual prototype, navigation, spending views, savings, and Subscription Detail.
- Accessibility checks: keyboard, focus, names, live regions, contrast, zoom/reflow, reduced motion, and 44px targets.
- Security checks: cross-account access, callback/session/CSRF controls, secret exposure, malformed input, and redacted logs.
- Migration checks: forward execution, failure, compatibility, rerun behavior where applicable, and recovery.
- Release smoke tests: environment health and critical user paths after deployment.

## Acceptance-criteria matrix

Every user-facing PR or QA report maps each applicable criterion:

| AC ID | Scenario | Test type | Evidence | Result | Defect |
| --- | --- | --- | --- | --- | --- |
| AC-01 | Expected behavior | Automated/manual | Link or command output | Pass/Fail | Issue or None |

Evidence must include the exact commit SHA, environment, browser/device or runtime, setup/data, expected and actual result, and artifact links. A new commit invalidates affected evidence until rerun.

## Independence and severity

QA validates; it does not define product scope, UX, architecture, or implementation. Ambiguity returns to the owning role.

- **Critical:** unsafe release, severe security/privacy failure, or unusable critical path — blocks release.
- **High:** acceptance failure, data integrity problem, or major regression — blocks release.
- **Medium/Low:** release disposition is documented and approved by the appropriate owner.

QA recommends **Approved**, **Changes required**, or **Blocked**. Product acceptance, technical approval, CI, and required release authority remain separate gates.
