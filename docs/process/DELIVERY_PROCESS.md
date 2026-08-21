# Delivery Process

> **Owner:** Project Manager
> **Status:** Canonical workflow
> **Last reviewed:** 2026-08-20

## Lifecycle

**Proposed → Product Defined → Design Ready → Technical Ready → Implementing → Review → Changes Required / Approved → QA Approved → Done → Released → Measured**

Release is distinct from code complete. A feature can move backward when new evidence invalidates an earlier gate.

## Ownership

- Founder: major product, business, security-risk, cost, access, merge, and release decisions during the supervised phase.
- Product Owner: what, why, value, scope, priority, and product acceptance.
- Senior Product Designer: flow, layout, interaction, states, responsive behavior, accessibility, and design consistency.
- Project Manager: stage, assignments, handoffs, blockers, conflict routing, traceability, and approval tracking.
- Tech Lead sub-agent: architecture, plan, implementation instructions, security/testing strategy, and technical review.
- Codex: implementation of the approved plan, tests, documentation, and implementation self-check.
- QA: independent acceptance, regression, risk, and release validation.

The Coordinator is not another decision authority. Each specialist records durable output in GitHub.

## Stage gates

1. **Proposed:** problem and expected value are recorded.
2. **Product Defined:** scope, priority, exclusions, and observable acceptance criteria are approved.
3. **Design Ready:** flow, hierarchy, interactions, states, responsive behavior, accessibility, and UX criteria are approved.
4. **Technical Ready:** architecture, data/API/security/migration/testing approach, sequencing, and implementer instructions are approved.
5. **Implementing:** Codex works on a short-lived branch without reinterpreting approved decisions.
6. **Review:** CI and Codex self-checks run; Tech Lead performs technical review; Designer and Product Owner review affected areas.
7. **Changes Required / Approved:** findings are assigned to the actual owner and resolved or explicitly dispositioned.
8. **QA Approved:** independent QA maps criteria and regressions to evidence on the exact commit.
9. **Done:** all applicable implementation, review, documentation, CI, traceability, and approval gates in the Definition of Done are complete. Done means code-complete and approved; it does not mean deployed.
10. **Released:** an authorized owner deploys the approved commit or artifact, records the environment and recovery checkpoint, and completes release smoke checks.
11. **Measured:** outcome is reviewed when metrics exist.

See [Definition of Ready](DEFINITION_OF_READY.md) and [Definition of Done](DEFINITION_OF_DONE.md).

## Source precedence

1. Explicit Founder decision.
2. Latest approved decision by the role owning that domain.
3. Approved repository documentation, issues, and PR records.
4. Current implementation and test evidence.
5. Historical conversation.

When sources conflict, stop and route the conflict. Do not silently choose.

## Feedback routing

- Product ambiguity or value/scope conflict → Product Owner.
- Flow, state, accessibility, responsive, or visual ambiguity → Designer.
- Architecture, API, data, security, migration, dependency, or test-strategy question → Tech Lead.
- Clear defect against an approved plan → Codex, then technical review.
- Critical/High validation failure → Changes Required and release blocked.
- Material vision, cost, security risk, access, or delivery tradeoff → Founder.

## Traceability

GitHub issue → feature specification/design → approved technical plan/ADR → branch → PR → automated tests/CI → reviews → QA matrix/report → release record.

No automation identity may push to `main`, merge, release, or bypass protection. Required outputs that matter after a conversation must be recorded in the project system.
