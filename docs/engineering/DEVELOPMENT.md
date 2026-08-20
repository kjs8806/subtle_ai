# Development Guide

## Prerequisites

- Node.js 22
- npm
- Git

## Commands

- npm ci
- npm run dev
- npm test
- npm run build
- git diff --check

The repository commits `package-lock.json`. Use `npm ci` for reproducible installs in CI and when validating a clean checkout. Use `npm install` only when intentionally changing dependencies and update the lockfile in the same change.

## Architecture rules

- Preserve the Vite PWA unless a demonstrated limitation justifies migration.
- Keep the deterministic receipt pipeline independent of persistence and provider adapters.
- Resolve all detail data, evidence, confidence, and recommendations through stable subscription IDs.
- Keep facts, inferences, and recommendations distinct.
- Keep API requests network-only in the service worker.
- Do not add production Gmail, AI, bank, notification, or background-sync integrations outside approved technical decisions.

The Tech Lead sub-agent owns architecture, technical planning, implementation instructions, security and testing strategy, and technical review. Codex implements the approved plan and performs implementation-level self-checks. Any architectural deviation must return to the Tech Lead for approval and repository documentation.

## Branch and review process

1. Sync main and create a short-lived feature, fix, or chore branch.
2. Read the relevant feature, design, engineering, and approved technical-plan documents.
3. Implement the smallest focused change.
4. Run tests, build, and whitespace checks; record Codex self-check evidence.
5. Open a pull request using the template.
6. Resolve Tech Lead technical review and CI findings.
7. Obtain independent QA for user-facing or risk-sensitive changes.
8. Obtain an additional qualified or Founder-directed review for security-sensitive, high-risk, or major architectural changes.
9. Merge only after required approvals.

## Current and planned quality automation

Current CI installs from the lockfile, runs the test suite, builds the application, and checks the complete push or pull-request change range for whitespace errors.

The following remain planned gaps:

- Add an explicit lint/static-analysis and code-formatting toolchain, then make those checks required in CI. `git diff --check` detects whitespace errors but is not a substitute for linting or formatting validation.
- Add GitHub's dependency-review workflow after confirming that the action is supported and enabled for this private repository. Dependabot remains enabled for npm and GitHub Actions updates in the meantime.

## Environment and secrets

No real provider secrets are required for the current mock flow. When runtime configuration is introduced, document variable names in .env.example with safe placeholder values. Never commit a populated environment file.
