# Contributing to Subtle AI

GitHub is the durable source of truth. Chats may help produce decisions, designs, plans, code, and reviews, but approved outcomes must be recorded in the repository.

## Before development

1. Start from a GitHub issue.
2. Assign or confirm a FEATURE-XXX identifier for product work.
3. Ensure product requirements and acceptance criteria are approved.
4. Ensure affected UX behavior and states are Design Ready.
5. Ensure major technical work has a written technical plan and approved decision changes.
6. Create a short-lived branch:
   - feature/FEATURE-XXX-short-name
   - fix/FEATURE-XXX-short-name
   - chore/short-name

Do not start production integrations that remain blocked in docs/engineering/TECH_DECISIONS.md.

## Development

- Read relevant product, design, architecture, and technical-decision documents.
- Make the smallest focused change.
- Preserve stable subscription IDs and evidence traceability.
- Keep credentials and long-lived secrets out of browser code and Git.
- Add or update tests for changed behavior.
- Update documentation when behavior, architecture, or decisions change.

## Validation

Run:

- npm test
- npm run build
- git diff --check

Record additional manual QA for user-facing behavior, including loading, empty, error, success, responsive, and accessibility states where applicable.

## Pull requests

Use the repository template. Link the issue and feature specification, map acceptance criteria, describe risk, attach QA evidence, and list known gaps. Keep PRs reviewable and short-lived. Prefer squash merge unless individual commits have lasting value.

A PR should not merge until CI passes, required review findings are resolved, and the appropriate product, design, technical, and QA approvals are recorded.
