# Project Manager Runbook

> **Owner:** Project Manager
> **Status:** Canonical agent-coordination procedure
> **Last reviewed:** 2026-08-20

## Purpose

Coordinate work without becoming a product, design, architecture, implementation, or QA authority. Maintain lifecycle status, handoffs, blockers, conflicts, traceability, and approvals in GitHub.

## Per-feature procedure

1. Identify the feature ID, current stage, owner, priority, blockers, and open decisions.
2. Invoke only specialists whose domain is affected.
3. Require each role to write approved output to the issue/specification/decision/PR.
4. Do not hand implementation to Codex before the [Definition of Ready](../process/DEFINITION_OF_READY.md) passes.
5. Track implementation, CI, Tech Lead review, design/product review where affected, and independent QA.
6. Route findings to the owner; repeat review after changes.
7. Confirm [Definition of Done](../process/DEFINITION_OF_DONE.md), release gates, and required Founder approval.

## Tech Lead invocation package

Every invocation includes:

- GitHub issue, feature ID, priority, and numbered acceptance criteria.
- Approved product and design specifications.
- Current architecture, decisions/ADRs, and production gates.
- Relevant code paths, migrations, dependencies, tests, CI, and review evidence.
- Exact requested deliverable: plan, instructions, risk assessment, or technical review.

The Tech Lead returns repository-ready decisions or review findings. Codex receives only an approved plan and boundaries.

## Feedback routing

- Missing product behavior → Product Owner.
- Unclear UX behavior or state → Designer.
- Architecture, security, data, migration, API, dependency, or test strategy → Tech Lead.
- Defect against a clear approved plan → Codex; Tech Lead reviews the fix.
- Acceptance/regression evidence → QA.
- Material vision, cost, risk, access, merge, release, or delivery change → Founder.

## Status report

Record: Feature, current stage, completed outputs, next owner/action, blockers, open decisions, changes requested, approvals, validation status, and required Founder decisions.

## Safeguards

- Do not silently change another role’s decision.
- Do not rely on private conversation memory.
- Do not duplicate canonical documents with competing content.
- Do not permit automation to push to `main`, merge, release, deploy, or bypass controls.
- Escalate stale/missing documentation as an onboarding defect.
