# Development Guide

## Prerequisites

- Node.js 22
- npm
- Git

## Commands

- npm install
- npm run dev
- npm test
- npm run build
- git diff --check

The current repository has no committed lockfile, so CI uses npm install. Adding and maintaining package-lock.json should be a near-term reproducibility improvement; after it is committed, CI should switch to npm ci.

## Architecture rules

- Preserve the Vite PWA unless a demonstrated limitation justifies migration.
- Keep the deterministic receipt pipeline independent of persistence and provider adapters.
- Resolve all detail data, evidence, confidence, and recommendations through stable subscription IDs.
- Keep facts, inferences, and recommendations distinct.
- Keep API requests network-only in the service worker.
- Do not add production Gmail, AI, bank, notification, or background-sync integrations outside approved technical decisions.

## Branch and review process

1. Sync main and create a short-lived feature, fix, or chore branch.
2. Read the relevant feature and engineering documents.
3. Implement the smallest focused change.
4. Run tests, build, and whitespace checks.
5. Open a pull request using the template.
6. Resolve technical review and CI findings.
7. Obtain independent QA for user-facing or risk-sensitive changes.
8. Merge only after required approvals.

## Environment and secrets

No real provider secrets are required for the current mock flow. When runtime configuration is introduced, document variable names in .env.example with safe placeholder values. Never commit a populated environment file.
