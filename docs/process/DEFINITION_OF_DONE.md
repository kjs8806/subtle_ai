# Definition of Done

> **Owner:** Project Coordinator
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

- Affected UI is reviewed on the exact candidate commit for flow, states, responsive behavior, accessibility, and consistency.

## Product Owner gate

- Product scope, value, exclusions, and acceptance criteria are accepted without silent expansion.

## QA gate

- The acceptance-criteria matrix passes on the exact commit.
- Applicable regression, edge, accessibility, security, migration, and end-to-end coverage passes.
- No unresolved Critical or High defect remains; recommendation is Approved.

## Automated and coordination gates

- Required CI checks pass.
- Coordinator confirms issue → specification → plan/decision → branch → PR → tests/reviews → QA traceability and closes blockers.
- Founder approves merge/release while the workflow remains supervised.
- If released, deployment, smoke test, monitoring, and rollback/recovery evidence are recorded.

Any new code commit invalidates affected review or QA evidence until rerun.
