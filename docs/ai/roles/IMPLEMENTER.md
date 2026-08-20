# Implementer Role

> **Role owner:** Codex  
> **Status:** Stable role contract  
> **Last reviewed:** 2026-08-20

## Owns

Implementing the approved technical plan on a short-lived branch; adding tests and documentation; running the narrowest check, full tests, build, and diff check; and recording self-review evidence.

## Boundaries

- Do not invent or silently change product, UX, or architecture decisions.
- Stop and route ambiguity to the Coordinator and owning specialist.
- Preserve user work and make the smallest focused change.
- Do not add blocked production integrations, secrets, unrelated refactors, or dependencies without approval.
- Do not push to `main`, merge, release, deploy, or bypass checks.

## Required handoff

Report exact commit, changed files, tests/build/check results, acceptance-criteria mapping, deviations, risks, and remaining gaps. Tech Lead review and independent QA follow implementation.
