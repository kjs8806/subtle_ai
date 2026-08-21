# Definition of Done

> **Owner:** Project Manager
> **Status:** Required completion gate
> **Last reviewed:** 2026-08-20

A feature is Done only when all applicable evidence is complete. Code complete is not release complete.

## Codex gate

- Approved scope is implemented on a branch.
- Required tests and documentation are complete.
- Self-review against the technical plan, acceptance criteria, and known risks is recorded.

## Tech Lead gate

- Architecture, security, data, migrations/recovery, maintainability, tests, dependencies, and technical correctness are approved.
- Review findings are resolved and durable decisions are documented.

## Designer gate

- Affected UI is reviewed on the exact reviewed PR head SHA for flow, states, responsive behavior, accessibility, and consistency.

## Product Owner gate

- Product scope, value, exclusions, and acceptance criteria are accepted without silent expansion.

## QA gate

- The acceptance-criteria matrix passes on the exact reviewed PR head SHA.
- Applicable regression, edge, accessibility, security, migration, and end-to-end coverage passes.
- No unresolved Critical or High defect remains; recommendation is Approved.

## Automated and coordination gates

- Required CI checks pass on the synthetic candidate merge for the recorded reviewed PR head and base. The PR records the reviewed head SHA, base SHA, candidate merge SHA, and CI run URL.
- Project Manager confirms issue → specification → plan/decision → branch → PR → tests/reviews → QA traceability and closes blockers.
- Founder approves merge/release while the workflow remains supervised.
- If released, deployment, smoke test, monitoring, and rollback/recovery evidence are recorded.

Any PR head change invalidates prior specialist review, QA evidence, and CI evidence until the affected checks and reviews run again against the new head and its new candidate merge.
