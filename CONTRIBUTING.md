# Contributing to Subtle AI

GitHub is the durable source of truth. Read the [Delivery Process](docs/process/DELIVERY_PROCESS.md), [Ready](docs/process/DEFINITION_OF_READY.md), [Done](docs/process/DEFINITION_OF_DONE.md), [AI Usage Policy](docs/ai/AI_USAGE_POLICY.md), affected architecture/decisions, and the assigned issue.

## Lean workflow

1. Start from one approved issue with understandable acceptance criteria.
2. One Codex Builder records a concise plan, assumptions, and material risks, then implements normal work immediately.
3. Make the smallest focused change; add affected tests and documentation; self-review and validate.
4. Open one focused PR and run CI.
5. Independent QA validates normal features and targeted routine fixes.
6. Invoke Product Owner, Product Designer, Security Reviewer, or an independent technical reviewer only when the trigger table requires it.
7. Founder reviews and merges after applicable gates pass.

Until FEATURE-001 is complete, keep one implementation workstream and one implementation PR. Do not start unrelated feature implementation.

## Validation

Run the narrowest relevant test first, then:

```sh
npm test
npm run build
git diff --check
```

Report exact files changed, command results, acceptance coverage, deviations, and residual risks. User-facing changes include applicable loading, empty, error, success, responsive, accessibility, and regression evidence.

No agent or automation may push to `main`, merge, release, deploy, expand the controlled test cohort, or bypass checks. Gmail, OAuth, authentication, tokens, secrets, personal data, authorization, deletion, or deployment security requires independent Security Reviewer approval.
