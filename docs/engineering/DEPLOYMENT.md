# Deployment

> **Owner:** Tech Lead  
> **Status:** No production deployment exists  
> **Last reviewed:** 2026-08-20

## Current state

The repository has local development and CI validation only. There is no approved staging or production environment, release pipeline, monitoring system, secret store, or rollback procedure. The Vite build output and mock Fastify server are not a production deployment design.

## Release gates

Before the first external environment is created, the Tech Lead must document and approve:

- Hosting and account ownership.
- Staging and production separation.
- Runtime configuration and least-privilege secret management.
- Database provisioning, backup, restore, and migration execution.
- HTTPS, session, OAuth callback, and network boundaries.
- Observability, sensitive-data redaction, alerting, and incident ownership.
- Versioning, deployment promotion, smoke tests, rollback or recovery, and release records.
- Data retention/deletion implementation aligned with approved product policy.

Security-sensitive access and production release require Founder approval during the supervised phase. Automation may prepare branches and PRs but may not deploy, merge, release, or bypass protections.

## Current validation artifact

`npm run build` proves that Vite can produce a static bundle. It does not establish production readiness. Use [RELEASE_CHECKLIST.md](../quality/RELEASE_CHECKLIST.md) when a deployable environment is approved.
