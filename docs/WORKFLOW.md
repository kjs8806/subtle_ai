# Delivery Workflow and Source of Truth

## Roles

- Founder: major product, business, security-risk, cost, and architectural tradeoffs.
- Product Owner: what to build, why, priority, scope, and product acceptance.
- Product Designer: user flow, interaction, states, accessibility, and design consistency.
- Project Coordinator: workflow, specialist invocation, handoffs, blockers, traceability, and approval tracking.
- Tech Lead sub-agent: architecture, technical planning, implementation instructions, security and testing strategy, and technical review.
- Codex: implementation of the approved technical plan, implementation-level self-checks, tests, and repository validation.
- QA: independent verification of requirements, regressions, and release quality.

The Project Coordinator invokes the Tech Lead as a dedicated specialist. The Coordinator does not replace specialist authority, and Codex is not the architecture authority.

## Source precedence

1. Explicit Founder decision.
2. Latest approved decision from the role owning that domain.
3. Approved repository documentation.
4. Current implementation.
5. Historical chat discussion.

GitHub is the durable source of truth. Meaningful conflicts must be surfaced to the owning role and resolved in the repository.

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

GitHub issue → feature specification → approved technical plan → branch → pull request → automated tests → technical review → QA evidence → release record.

Each PR must link its issue and specification and explain how acceptance criteria were validated.

## Specialist handoff contract

Every Coordinator handoff to the Tech Lead must include:

- Relevant GitHub issue and approved acceptance criteria.
- Approved product and design specifications.
- Current architecture documents and technical decisions.
- Relevant code, migrations, tests, CI output, and other review evidence.
- The precise deliverable expected from the Tech Lead.

The Tech Lead returns an approved technical plan or review findings through repository artifacts. Codex receives that approved plan and does not silently change architecture, requirements, or UX decisions.

## Feedback routing

- Missing product behavior → Product Owner.
- Unclear interaction or UI state → Product Designer.
- Architecture, security, data, API, or testing strategy → Tech Lead sub-agent.
- Clear implementation defect → Codex under the approved plan; return to Tech Lead if the fix changes architecture.
- Major scope, business, security-risk, cost, or delivery tradeoff → Founder.

QA does not invent requirements, and implementation does not silently reinterpret them.

## Review safeguards

The Tech Lead reviews technical correctness after implementation, but is not the only quality gate for work it directed:

- CI must pass.
- Codex records implementation-level self-checks.
- Independent QA validates requirements and regressions.
- Security-sensitive, high-risk, or major architectural changes require an additional qualified review or Founder-directed review before merge.

## Feature records

Current canonical FEATURE-001 product and UX record:

- docs/product/features/FEATURE-001.md

Do not create duplicate specifications with conflicting content. Technical decisions belong in docs/engineering, while PRs and QA reports link back to the canonical feature record.
