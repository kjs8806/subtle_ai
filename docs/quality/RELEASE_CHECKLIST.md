# Release Checklist

> **Owner:** QA/Test Engineer  
> **Coordinator:** Project Coordinator  
> **Status:** Production release gate  
> **Last reviewed:** 2026-08-20

The project currently has no production deployment. This checklist does not authorize one.

## Identity and traceability

- [ ] Release version and exact commit are recorded.
- [ ] Issues, specifications, decisions, PRs, tests, QA report, and release record are linked.
- [ ] CI required checks pass on the release commit.

## Product and design

- [ ] Product Owner accepted scope and numbered acceptance criteria.
- [ ] Designer reviewed flows, states, responsive behavior, accessibility, and design consistency on the release commit.
- [ ] User-facing documentation and consent copy are current.

## Technical and security

- [ ] Tech Lead approved architecture, implementation, tests, dependencies, and known risks.
- [ ] Required ADRs and technical decisions are accepted.
- [ ] Secrets, authorization, privacy, retention, logging, and least privilege are validated.
- [ ] Migrations and compatibility are tested with backup and recovery evidence.
- [ ] Critical and High findings are closed.

## QA

- [ ] Acceptance-criteria matrix passes on the exact commit.
- [ ] Regression, accessibility, security, integration, and end-to-end coverage is complete for affected risks.
- [ ] Environment, test data, artifacts, defects, and residual risks are recorded.
- [ ] QA recommendation is Approved.

## Deployment and recovery

- [ ] Staging smoke test passed.
- [ ] Monitoring, alert ownership, sensitive-data redaction, and health checks are ready.
- [ ] Deployment, rollback/recovery, and rollback decision owner are confirmed.
- [ ] Post-deployment smoke test and observation window are assigned.

## Approval

- [ ] Coordinator confirms complete traceability and handoffs.
- [ ] Founder approves merge/release while the autonomous workflow remains supervised.
