# Chat-Independent Onboarding Simulation

> **Owner:** QA/Test Engineer
> **Coordinator:** Project Coordinator
> **Status:** Required onboarding verification; currently Blocked
> **Tracking issue:** [GitHub Issue #8](https://github.com/kjs8806/subscription_app/issues/8)
> **Last reviewed:** 2026-08-20

## Purpose

Verify that a contributor without access to private AI conversations can set up the project, understand it, find work, and follow the delivery process using only the repository and linked project records.

Issue #8 is the canonical simulation task. It is currently **Blocked**, not Ready or eligible for implementation, until the live issue links a draft PR at an exact reviewed head commit, CI for the associated base and synthetic candidate merge, and the required canonical records. Inspect its current lifecycle status before every run; this document must not be treated as evidence that the issue is Ready.

## Independence and starting record

Before testing, QA records:

- [ ] Tester name or identifier: `TBD`
- [ ] Tester role: `TBD`
- [ ] Confirmation that the tester did not use private project chats: `TBD`
- [ ] Repository URL: `https://github.com/kjs8806/subscription_app`
- [ ] Starting commit SHA: `TBD`
- [ ] Date/time and timezone: `TBD`
- [ ] OS, Node, npm, and browser versions: `TBD`
- [ ] Environment and configuration used: `TBD`
- [ ] Tracking issue and observed status: [Issue #8](https://github.com/kjs8806/subscription_app/issues/8) — recheck; presently Blocked

## Required external links

The Coordinator supplies real records. Placeholders are intentionally incomplete and block approval until resolved.

- [ ] Actual small issue whose live status satisfies Definition of Ready: `TBD`
- [ ] Completed or supervised example issue: `TBD`
- [ ] Approved feature specification and acceptance criteria: `TBD`
- [ ] Approved design and technical plan/ADR, when applicable: `TBD`
- [ ] Pull request and exact reviewed PR head SHA: `TBD`
- [ ] Base SHA for the recorded head: `TBD`
- [ ] Synthetic candidate merge SHA: `TBD`
- [ ] CI run URL for that head/base/candidate identity: `TBD`
- [ ] Tech Lead, Product Designer, and Product Owner reviews as applicable: `TBD`
- [ ] QA report and acceptance-criteria matrix: `TBD`
- [ ] Release record, or explicit confirmation that release is not applicable: `TBD`

QA records **Blocked** rather than inventing, inferring, or substituting missing evidence.

## Simulation scenarios

Using repository records only, the tester must:

1. Explain the user problem, product outcome, current experience, and scope boundaries.
2. Identify the active milestone, its current lifecycle status, and the next approved work without treating candidates as approved.
3. Find the rationale and owner for important product, design, and technical decisions.
4. Clone the repository, install dependencies, start the app and API, and identify the URLs actually emitted.
5. Run the documented test, build, and formatting checks.
6. Explain what makes a feature Ready, Done, Released, and Measured.
7. Locate an actual eligible task by checking its live issue status and linked gate evidence.
8. Explain how to create a compliant branch and PR, map acceptance criteria to evidence, and request the right reviews.
9. Identify where to route product, UX, technical, implementation, QA, access, and Founder decisions.
10. Identify the current production blockers without attempting a production integration.

## Command and result record

| Command or action | Expected result | Actual result | Evidence link | Pass/Fail |
| --- | --- | --- | --- | --- |
| `npm ci` | Dependencies install from lockfile | TBD | TBD | TBD |
| `npm run dev` | Local app and API start; emitted URLs recorded | TBD | TBD | TBD |
| `npm test` | Automated test command completes | TBD | TBD | TBD |
| `npm run test:server` | Narrow server suite completes | TBD | TBD | TBD |
| `npm run build` | Production build command completes | TBD | TBD | TBD |
| `git diff --check` | No whitespace errors | TBD | TBD | TBD |
| Documentation scenarios 1–10 | Answers supported by linked records | TBD | TBD | TBD |

Do not copy secrets, email content, or other sensitive data into evidence. Record the exact commit and environment for every result.

## Assistance log

Record every question, hint, correction, missing permission, or undocumented step supplied outside the repository.

| Time | Assistance requested or provided | Why repository guidance was insufficient | Owner for correction | Issue/link |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD |

## Gap log

| Gap | Severity | Owning role | Required change | Tracking link | Status |
| --- | --- | --- | --- | --- | --- |
| Missing Ready issue and completed/supervised delivery-chain links | High | Project Coordinator | Supply canonical, current links in Issue #8 and this report | [Issue #8](https://github.com/kjs8806/subscription_app/issues/8) | Blocked |

Critical and High gaps block approval. Route content gaps to the role that owns the affected decision; route traceability and handoff gaps to the Coordinator.

## Pass criteria

The simulation passes only when:

- All required external links resolve to real, current records.
- The tester completes every scenario from repository/project records without private-chat assistance.
- Documented commands work in the recorded environment, or a verified defect is filed with an owner.
- The tester correctly distinguishes approved work from proposed candidates and blocked tasks.
- No Critical or High onboarding gap remains open.
- Manual and specialist evidence identifies the exact reviewed PR head; CI evidence identifies that head, its base, the synthetic candidate merge, and the CI run URL.

## Verdict

- **Approved:** every pass criterion is met.
- **Changes Required:** the run completed but correctable non-blocking gaps remain.
- **Blocked:** required inputs, access, evidence, or Critical/High gaps prevent a valid run.

Current verdict: **Blocked**. Issue #8 does not yet contain all required reviewed-head, base, candidate-merge, CI-run, and canonical-chain evidence.

## QA sign-off

- Verdict: `Blocked / Changes Required / Approved`
- Reviewed PR head SHA: `TBD`
- Base SHA: `TBD`
- Candidate merge SHA: `TBD`
- CI run URL: `TBD`
- QA owner: `TBD`
- Date: `TBD`
- Report/evidence link: `TBD`
- Open defects or gaps: `TBD`
