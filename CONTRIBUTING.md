# Contributing to Subtle AI

GitHub is the durable source of truth. Chats and sub-agents may help produce decisions, designs, plans, code, and reviews, but approved outcomes must be recorded in the repository.

## Before development

1. Start from a GitHub issue.
2. Assign or confirm a FEATURE-XXX identifier for product work.
3. Ensure product requirements and acceptance criteria are approved.
4. Ensure affected UX behavior and states are Design Ready.
5. Have the Project Coordinator invoke the Tech Lead sub-agent with the complete handoff contract.
6. Ensure major technical work has a written, approved technical plan and any required decision-register updates.
7. Create a short-lived branch:
   - feature/FEATURE-XXX-short-name
   - fix/FEATURE-XXX-short-name
   - chore/short-name

Do not start production integrations that remain blocked in docs/engineering/TECH_DECISIONS.md.

## Tech Lead handoff contract

The handoff must identify:

- The GitHub issue and approved acceptance criteria.
- Approved product and design specifications.
- Relevant architecture and technical decisions.
- Relevant code, migrations, tests, CI output, and other evidence.
- The precise requested deliverable: plan, implementation instructions, risk assessment, or technical review.

The Tech Lead owns architecture, technical planning, implementation instructions, security and testing strategy, and technical review. Codex implements the approved plan and performs implementation-level self-checks; Codex must not silently assume architecture authority.

## Development

- Read relevant product, design, architecture, technical-decision, and approved technical-plan documents.
- Make the smallest focused change.
- Preserve stable subscription IDs and evidence traceability.
- Keep credentials and long-lived secrets out of browser code and Git.
- Add or update tests for changed behavior.
- Update documentation when behavior, architecture, or decisions change.
- Record any necessary deviation and return it to the Tech Lead for approval before proceeding.

## Validation

Run:

- npm test
- npm run build
- git diff --check

Record additional manual QA for user-facing behavior, including loading, empty, error, success, responsive, and accessibility states where applicable.

## Pull requests

Use the repository template. Link the issue and feature specification, map acceptance criteria, describe risk, attach QA evidence, and list known gaps. Keep PRs reviewable and short-lived. Prefer squash merge unless individual commits have lasting value.

A PR should not merge until:

- CI passes.
- Codex implementation self-checks are recorded.
- Tech Lead review findings are resolved.
- Independent QA validates applicable requirements and regressions.
- Appropriate product and design approvals are recorded.
- Security-sensitive, high-risk, or major architectural changes receive an additional qualified review or Founder-directed review.

The Tech Lead must not be the only reviewer of an implementation it closely directed.
