# Definition of Ready

> **Owner:** Project Manager
> **Status:** Required implementation gate
> **Last reviewed:** 2026-08-20

A feature is Ready for Development only when every applicable owner has supplied and approved its gate.

## Product Owner gate

- User problem, expected value, scope, exclusions, and priority are clear.
- Acceptance criteria are numbered, observable, and complete for important behavior.
- Founder decisions are resolved or explicitly identified as blockers.

## Designer gate

- User flow, structure, interactions, and component behavior are defined.
- Loading, empty, error, cancelled, success, and permission states are covered as applicable.
- Responsive and accessibility behavior and UX acceptance criteria are recorded.

## Tech Lead gate

- Owning modules, architecture, APIs/data, security/privacy, migrations/recovery, tests, dependencies, and implementation sequence are defined.
- Required ADRs/decision-register entries are approved.
- No unresolved Critical or High issue, defect, or risk blocks implementation under the severity policy in [TEST_STRATEGY.md](../quality/TEST_STRATEGY.md).
- Codex instructions identify boundaries, validation, and prohibited scope.

## QA gate

- Criteria are objectively testable.
- Required fixtures, environments, evidence sources, regressions, and risk-based coverage are identifiable.
- Product or UX ambiguity is returned to its owner.

## Project Manager gate

- Issue, feature ID, owner, stage, approved requirements/design/plan, decisions, dependencies, blockers, and expected deliverable are linked.
- The feature is marked **Technical Ready** and eligible for implementation handoff.

If any required item is missing, the feature remains at its earlier lifecycle stage.
