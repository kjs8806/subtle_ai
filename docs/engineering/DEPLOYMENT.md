# Deployment

> **Owner:** Tech Lead
> **Status:** No production deployment exists
> **Last reviewed:** 2026-08-21

## Current state

The repository has local development and CI validation only. There is no approved staging or production environment, release pipeline, monitoring system, secret store, or rollback procedure. `npm run preview` and the Vite build output are local validation tools, not deployment. The mock Fastify server is not a production backend.

The current server configuration can fall back to a default session secret. That fallback is incomplete and is a production blocker. A production startup must reject a missing, empty, known-default, or otherwise invalid `SESSION_SECRET`; the value must come from an approved secret store and support controlled rotation.

The controlled Codespaces Google configuration uses `GOOGLE_OIDC_REDIRECT_URI` for sign-in and `GOOGLE_GMAIL_REDIRECT_URI` for Gmail authorization. `TOKEN_ENCRYPTION_KEY` is required for encrypted refresh-token custody; secret values must remain outside Git.

## Runtime persistence configuration

`PERSISTENCE_PROVIDER` selects what `node server/app.js` uses at startup, via the composition root in `server/bootstrap.js`:

- `PERSISTENCE_PROVIDER=memory` (default) — an in-process, ephemeral repository. Data does not survive a restart. Intended for local development and deterministic tests only.
- `PERSISTENCE_PROVIDER=postgres` — connects to `DATABASE_URL`, runs any unapplied migrations under `migrations/`, and only then starts accepting requests. Startup fails clearly (non-zero exit, no silent fallback to memory) if `DATABASE_URL` is missing, the database is unreachable, or a migration fails.

`GMAIL_PROVIDER=google` (real Gmail) requires `PERSISTENCE_PROVIDER=postgres`; configuration validation rejects the combination of real Gmail with ephemeral memory persistence, since real-Gmail validation depends on data surviving a restart.

For the supervised Codespaces FEATURE-001 environment, the approved PostgreSQL runtime runs migrations during controlled startup (see [MIGRATIONS.md](MIGRATIONS.md)). This is not a production migration pipeline.

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

## Staging gate

Staging must use production-like identity, network, configuration, database, token, and secret boundaries without production user data. Integration, end-to-end, migration/recovery, and security tests must pass there before promotion.

## Promotion and recovery record

Every promoted release records:

- Exact commit and immutable artifact identity.
- Approved CI, technical review, QA report, and release authority.
- Configuration and dependency review results without exposing secret values.
- Database migration checkpoint and verified backup/recovery evidence.
- Pre- and post-deployment smoke results.
- Monitoring dashboard/alert ownership and observation window.
- Rollback trigger, decision owner, recovery procedure, and outcome.
- Release timestamp, environment, known risks, and status.

Security-sensitive access and production release require Founder approval during the supervised phase. Automation may prepare branches and PRs but may not deploy, merge, release, or bypass protections.

## Current validation artifact

`npm run build` proves that Vite can produce a static bundle. It does not establish production readiness. Use [RELEASE_CHECKLIST.md](../quality/RELEASE_CHECKLIST.md) when a deployable environment is approved.
