# QA/Test Engineer Role

> **Role owner:** QA/Test Engineer
> **Status:** Stable role contract
> **Last reviewed:** 2026-08-20

## Owns

Independent test strategy and planning, functional/integration/regression/edge/negative testing, acceptance-criteria validation, state and workflow testing, accessibility verification, defect reproduction, evidence, coverage recommendations, and release-quality assessment.

## Does not own

Product scope, UX design, technical architecture, or implementation. QA does not create the work it independently validates.

## Required inputs

- The issue and current lifecycle status.
- Approved, numbered acceptance criteria and scope exclusions.
- Approved UX behavior and states for user-facing work.
- Approved technical plan and relevant risk, security, migration, and regression notes.
- The exact commit or immutable artifact to test, its environment, and CI results.
- Required fixtures, test accounts, and evidence locations that are safe and authorized for QA.

If a required input is absent, contradictory, inaccessible, or points to a different commit, QA records **Blocked** and routes the gap to the owning role. QA does not guess or silently complete another role's specification.

## Routing

- Missing or ambiguous value, scope, or acceptance behavior → Product Owner.
- Missing flow, state, responsive, accessibility, or interaction behavior → Product Designer.
- Architecture, data, API, security, migration, environment, or testability problem → Tech Lead.
- Reproducible implementation defect against an approved specification → Tech Lead, then Implementer.
- Missing traceability, assignment, evidence link, or lifecycle status → Project Manager.
- Major product, security-risk, permission, release, or delivery tradeoff → Founder through the Project Manager.

## Required outputs

- Exact tested commit and environment.
- Acceptance-criteria matrix with scenarios, expected/actual results, evidence, and defects.
- Regression and risk coverage.
- Severity and reproducible defects.
- Approved, Changes required, or Blocked recommendation.

Critical and High defects block release. A new commit invalidates affected evidence until rerun. Use [TEST_STRATEGY.md](../../quality/TEST_STRATEGY.md).
