# Delivery Workflow and Source of Truth

## Roles

- Founder: major product, business, security-risk, cost, and architectural tradeoffs.
- Product Owner: what to build, why, priority, scope, and product acceptance.
- Product Designer: user flow, interaction, states, accessibility, and design consistency.
- Codex: technical design, implementation, self-review, and repository validation.
- QA: independent verification and release-quality assessment.
- Coordinator: status, handoffs, blockers, traceability, and approval tracking.

The Coordinator does not replace specialist authority.

## Source precedence

1. Explicit Founder decision.
2. Latest approved decision from the role owning that domain.
3. Approved repository documentation.
4. Current implementation.
5. Historical chat discussion.

Meaningful conflicts must be surfaced to the owning role and resolved in the repository.

## Lifecycle

1. Proposed
2. Product Defined
3. Design Ready
4. Technical Ready
5. Implementing
6. Review
7. Changes Required or Approved
8. QA Approved
9. Released
10. Measured, when applicable

The repository may use equivalent GitHub labels, but feature documents must state their current lifecycle stage.

## Required traceability

GitHub issue → feature specification → branch → pull request → automated tests → QA evidence → release record.

Each PR must link its issue and specification and explain how acceptance criteria were validated.

## Feedback routing

- Missing product behavior → Product Owner.
- Unclear interaction or UI state → Product Designer.
- Architecture, security, data, API, or testing strategy → Codex as Tech Lead.
- Clear implementation defect → Codex implementation work.
- Major scope, business, security-risk, cost, or delivery tradeoff → Founder.

QA does not invent requirements, and implementation does not silently reinterpret them.

## Feature records

Current canonical FEATURE-001 product and UX record:
- docs/product/features/FEATURE-001.md

Do not create duplicate specifications with conflicting content. Technical decisions belong in docs/engineering, while PRs and QA reports link back to the canonical feature record.
