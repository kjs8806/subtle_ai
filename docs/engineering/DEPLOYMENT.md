# Deployment

> **Owner:** Tech Lead
> **Status:** Deployment artifacts prepared (MVP-BETA-007, #44); no live Cloud Run service or Neon database has been provisioned yet
> **Last reviewed:** 2026-08-25

## Current state

This document describes an **approved, implemented, but not yet provisioned** deployment. Every code, container, CI/CD, and configuration change it describes is merged and tested. No Google Cloud project, Cloud Run service, Artifact Registry repository, or Neon database has actually been created from this repository - the implementing session had no Google Cloud or Neon credentials available, and deliberately did not fabricate them (see "Known limitations" below). This document is the reproducible runbook a human with the appropriate account access follows to create them.

## Approved architecture

```text
Canada / US beta users
        |
      HTTPS
        |
        v
Google Cloud Run
- existing Vite PWA (built to dist/, served same-origin)
- existing Node.js/Fastify API (/api/v1)
- real Google OIDC + Gmail OAuth provider
        |
        | TLS
        v
Neon PostgreSQL
- persistent beta database
- free tier initially
```

One Cloud Run service serves both the built PWA and the API from the same origin - this avoids CORS and cross-domain cookie/session complexity entirely, and matches the approved architecture exactly. See [ARCHITECTURE.md](ARCHITECTURE.md) for the broader application design this deploys.

### Region selection

| | Selected | Reason |
| --- | --- | --- |
| **Cloud Run region** | `us-central1` (Iowa) | Google's most mature, lowest-latency-average region for a combined Canada/US audience, with full feature availability and typically the lowest cost tier. `northamerica-northeast1` (Montreal) is the documented alternative if Canadian data residency becomes a hard requirement - re-evaluate before provisioning if so. |
| **Neon region** | The Neon region physically closest to `us-central1` at provisioning time (as of this writing, Neon's US East region, backed by AWS `us-east-2`, Ohio, is the closest available option) | Minimizes Cloud Run <-> database latency. **Verify Neon's currently offered regions when creating the project** - the exact list is a Neon platform detail this document cannot guarantee is still current; do not assume the option named here still exists or is still the closest without checking. |

Do not introduce cross-continent database traffic (e.g. a Neon EU/APAC region) for this beta audience.

## Environment configuration

`NODE_ENV=production` is the deployment environment marker. Setting it activates two additional, deliberately strict behaviors on top of everything `GMAIL_PROVIDER=google` already activates (see below):

- `server/config/env.js`'s `validateConfig` **rejects startup outright** if `PERSISTENCE_PROVIDER` is not `postgres`, or if `GMAIL_PROVIDER` is not `google`, whenever `NODE_ENV=production`. There is no code path by which a production-flagged process can silently run the mock Gmail provider or ephemeral memory persistence - a misconfigured deployment fails to start at all, rather than starting in a superficially healthy but unsafe fallback mode.
- `server/config/env.js` defaults `HOST` to `0.0.0.0` instead of `127.0.0.1` (Cloud Run traffic arrives over the container's network interface, not localhost).

Session cookies, OAuth-state cookies, and same-origin enforcement on state-changing endpoints activate whenever `NODE_ENV=production` **or** `GMAIL_PROVIDER=google` (not `NODE_ENV` alone - this matters for non-Cloud-Run environments like Codespaces validation, which forward HTTPS without setting `NODE_ENV=production`).

### Required environment variables

Set by the deploy workflow's `gcloud run deploy --set-env-vars` (non-sensitive) or `--set-secrets` (sensitive, from Secret Manager - see below):

| Variable | Sensitive | Source | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | No | env var | `production` |
| `GMAIL_PROVIDER` | No | env var | `google` - required, see above |
| `PERSISTENCE_PROVIDER` | No | env var | `postgres` - required, see above |
| `PUBLIC_ORIGIN` | No | env var | The Cloud Run service's actual HTTPS URL. Used for same-origin/CSRF enforcement - do not hardcode this anywhere else in application code. |
| `GOOGLE_OIDC_REDIRECT_URI` | No | env var | `<PUBLIC_ORIGIN>/api/v1/auth/google/callback` - the exact route defined in `server/app.js`, not assumed from this document |
| `GOOGLE_GMAIL_REDIRECT_URI` | No | env var | `<PUBLIC_ORIGIN>/api/v1/sources/gmail/callback` - same caveat |
| `DATABASE_URL` | **Yes** | Secret Manager | Neon connection string, TLS required (Neon connection strings include `sslmode=require` by default - don't strip it) |
| `SESSION_SECRET` | **Yes** | Secret Manager | >= 32 random bytes; `validateConfig` rejects anything shorter or equal to the `local-development-only` default |
| `TOKEN_ENCRYPTION_KEY` | **Yes** | Secret Manager | >= 32 characters; encrypts Gmail refresh tokens at rest (`server/security/tokenVault.js`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | **Yes** (secret is) | Secret Manager | From the approved Google Cloud OAuth client - see "Google OAuth configuration" below |
| `PORT` | No | Cloud Run-injected | Do not set manually; Cloud Run supplies this and the app already reads `process.env.PORT` |

Optional, with safe defaults (see "Database connection pool" below): `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`.

## Secrets

Production/beta secrets are never committed to Git and never appear in Vite-bundled client code (Vite environment variables are compiled into browser JavaScript - server secrets must never be prefixed for Vite exposure, and none currently are).

Store the sensitive values listed above in **Google Cloud Secret Manager**, one secret per value, and inject them into the Cloud Run revision with `--set-secrets` (see `.github/workflows/deploy.yml`'s `deploy` job) rather than `--set-env-vars`.

`server/app.js`'s Fastify logger redacts `req.headers.authorization`, `req.headers.cookie`, `res.headers.set-cookie`, and any `refreshToken`/`ciphertext`/`body` field whenever `NODE_ENV=production` (or `GMAIL_PROVIDER=google`). Never log `DATABASE_URL`, OAuth authorization codes, access/refresh tokens, encrypted token ciphertext, or receipt body content beyond what evidence provenance already records deliberately.

### Service accounts

SEC-055-01 (Security Manager remediation, PR #55): `deploy.yml` uses **two distinct Google Cloud service accounts**, never one shared identity. Neither is granted broad project-wide Editor/Owner permissions.

| | **Deploy service account** (`GCP_SERVICE_ACCOUNT` secret) | **Runtime service account** (`CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT` variable) |
| --- | --- | --- |
| Used by | GitHub Actions, via Workload Identity Federation (`google-github-actions/auth`), in the `build-and-push`, `migrate`, and `deploy` jobs | The running Cloud Run container only, via `gcloud run deploy --service-account` |
| Purpose | Build and push the image, run migrations, deploy the revision | Serve the application at runtime - read its own runtime secrets, connect to Neon |
| Exact roles | `roles/run.admin` on the Cloud Run service (deploying with `--allow-unauthenticated` requires `run.services.setIamPolicy`, which the narrower `roles/run.developer` does not grant); `roles/artifactregistry.writer` on the `ARTIFACT_REGISTRY_REPO` repository; `roles/secretmanager.secretAccessor` on each of the five runtime secrets below (required both to reference them in the `deploy` job's `--set-secrets` and for the `migrate` job to read `DATABASE_URL` directly); `roles/iam.serviceAccountUser` granted **on the runtime service account resource specifically** (required for `--service-account` to deploy as it) | `roles/secretmanager.secretAccessor` on exactly `DATABASE_URL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` - nothing else |
| Never used for | Running the application | Building, pushing, migrating, or deploying anything |

`gcloud run deploy`'s `--service-account` flag (SEC-055-01) pins the runtime identity explicitly; omitting it would silently fall back to the project's default compute service account, which typically holds broad Editor-equivalent permissions the running application must never have. Create both service accounts and grant exactly the roles above before the first deploy - see "Release gates" below.

**SEC-055-05 (Security Manager remediation, PR #55):** `google-github-actions/auth` writes a temporary Application Default Credentials file into `$GITHUB_WORKSPACE` (the repo root) by default, matching `gha-creds-*.json`, and the Dockerfile's build stage does `COPY . .`. `build-and-push` now **builds the image before authenticating to Google at all** - building never needs GCP credentials, so the credential file simply does not exist on disk yet when `docker build .` runs. Authentication happens only immediately before the Artifact Registry push that actually needs it. `.dockerignore` and `.gitignore` both exclude `gha-creds-*.json` as defense in depth, in case a future edit ever reorders these steps again. `id-token: write` (required to mint the OIDC token WIF auth needs) is granted only on the three jobs that actually authenticate to Google (`build-and-push`, `migrate`, `deploy`), not workflow-wide.

## Database - Neon PostgreSQL

1. Create a Neon project in the region selected above.
2. Create a database and a role with least-privilege access to it (not the Neon project's admin role).
3. Copy the pooled connection string Neon provides (see "Database connection pool" - Neon's pooled endpoint, backed by PgBouncer, is appropriate for Cloud Run's elastic instance model) into **Secret Manager only**, as `DATABASE_URL` - see "Database secret custody" immediately below for why this is the *sole* place it is stored.
4. TLS is enforced by Neon's connection string (`sslmode=require`) automatically - `pg`'s `Pool` honors this without additional code.
5. Run `npm run migrate` against it (see "Migrations" below) before the first deploy.

The application speaks ordinary PostgreSQL throughout (`server/persistence/postgresRepository.js`, `pg`) - nothing is coupled to a Neon-specific API. Neon is interchangeable with any TLS-reachable PostgreSQL 16 instance without an application code change, should that ever be needed.

### Database secret custody

SEC-055-04 (Security Manager remediation, PR #55): **Google Secret Manager is the sole authoritative store for the production `DATABASE_URL`.** It is not duplicated as a GitHub Environment Secret. Earlier revisions of `deploy.yml` read `DATABASE_URL` from a GitHub Environment Secret in the `migrate` job - that meant the same long-lived Neon credential existed in two independently-rotated places, doubling the credential's exposure surface and rotation burden without a corresponding benefit.

`migrate` now authenticates to Google Cloud via the same Workload Identity Federation deploy service account as `build-and-push`/`deploy` (see "Service accounts" above, which already needs `roles/secretmanager.secretAccessor` on `DATABASE_URL` to reference it in the `deploy` job's `--set-secrets`), and fetches the value directly and in-step:

```yaml
- name: Run database migrations
  run: |
    DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project "${{ vars.GCP_PROJECT_ID }}")"
    echo "::add-mask::$DATABASE_URL"
    export DATABASE_URL
    npm run migrate
```

The value is masked in the log immediately after being read, exported only into that step's own shell environment, and never written to a job output or any other durable location. If this custody model is ever revisited (for example, to support a migration runner outside GitHub Actions that cannot assume the WIF identity), duplicating the credential into a second store must be an explicit, documented decision - not a default.

### Database connection pool

Cloud Run is elastic: it can run several instances concurrently under load, each with its own independent `pg.Pool`. `server/bootstrap.js` sizes that pool conservatively rather than using `pg`'s single-server-oriented default (`max: 10`):

| Setting | Default | Env override | Rationale |
| --- | --- | --- | --- |
| `max` (pool size) | `5` | `DB_POOL_MAX` | Paired with Cloud Run's `--max-instances` (see below), bounds the worst-case total connection count to `max-instances × DB_POOL_MAX` - predictable and small enough to stay well under a Neon free-tier project's connection ceiling even before Neon's own pooled endpoint multiplexing is counted. |
| `idleTimeoutMillis` | `10000` (10s) | `DB_POOL_IDLE_TIMEOUT_MS` | Releases idle connections promptly during Cloud Run's normal scale-to-zero idle periods instead of holding them open against nothing. |
| `connectionTimeoutMillis` | `5000` (5s) | `DB_POOL_CONNECTION_TIMEOUT_MS` | A genuinely unreachable database fails a request fast and observably, instead of hanging. |

Combine this with Cloud Run's `--max-instances` (set via the `CLOUD_RUN_MAX_INSTANCES` deploy variable, see below) as the actual safeguard against connection exhaustion - the pool setting alone only bounds *per-instance* usage. Prefer Neon's pooled connection endpoint (PgBouncer-backed, designed for exactly this many-short-lived-clients pattern) over its direct endpoint for `DATABASE_URL` in this deployment.

## Migrations

`migrations/*.sql` are ordered, checksummed-by-filename SQL files applied by `server/persistence/migrations.js`'s `runMigrations`, which is lock-protected (`pg_advisory_lock`) and idempotent (tracks applied versions in `schema_migrations`) - so it is already safe if it somehow runs concurrently.

Two ways it runs, deliberately different in scope:

1. **Automatic, on every `PERSISTENCE_PROVIDER=postgres` boot** (`server/bootstrap.js`'s `createRuntime`) - a safety net for local development and CI, where implicit-on-boot is convenient and low-risk. A migration failure here fails that process's startup (non-zero exit), never a silent fallback.
2. **Explicit, as its own pre-deploy step in production** - `npm run migrate` (`server/persistence/migrate.js`), run by `.github/workflows/deploy.yml`'s `migrate` job, strictly *before* `gcloud run deploy`. This is the preferred production pattern: a migration failure here is a clean, observable, promotion-blocking CI job failure, not something that only surfaces when some autoscaled Cloud Run instance happens to cold-start later. It requires only `DATABASE_URL`.

Prefer forward-compatible schema changes (additive columns/tables, backfills that don't require the old application version to stop reading) so that an application rollback (see below) is never blocked by an already-applied migration. No migration in this repository has been written with a scripted "down" - reversing a migration, if ever needed, is a hand-written follow-up migration, not an automated rollback tool; this repository does not build one.

## Container

`Dockerfile` is a two-stage build:

1. **Build stage** (`node:22-alpine`): `npm ci` (full dependencies), `npm run build` (Vite production build to `dist/`).
2. **Runtime stage** (`node:22-alpine`): `npm ci --omit=dev` (production dependencies only), then copies exactly `server/`, `src/` (the Fastify server imports `src/services/*.js` directly at runtime - receipt parsing, attention-item building, price-change detection - this is server-side application code, not something Vite bundles away), `migrations/`, and `dist/` (from the build stage). Runs as the `node:22-alpine` image's built-in non-root `node` user. `NODE_ENV=production` is baked into the runtime stage - this image is never used for local development, and baking it in guarantees the fail-closed configuration validation above is always active for anything run from it.

`CMD ["node", "server/app.js"]` - Cloud Run injects `PORT` and the app already listens on it via `server/config/env.js`.

**Validation performed:** `docker build`/`docker run` could not be executed in the implementing sandbox (no Docker daemon access there - see "Known limitations"). The runtime stage's exact file closure (`package.json`, `server/`, `src/`, `migrations/`, `dist/`, `npm ci --omit=dev`) was instead reproduced directly on disk and booted with `node server/app.js`; it started cleanly and both `/api/v1/health` and `/api/v1/health/ready` responded correctly, and `GET /` served the built `dist/index.html`. This gives strong confidence the Dockerfile is correct, but a real `docker build` should still be the first step of the first actual deployment, before trusting it further.

## Static application (Vite PWA)

`server/app.js` registers `@fastify/static` against `dist/` and falls back to `dist/index.html` for any GET request that isn't under `/api/v1/` and doesn't match a real static file - the standard SPA (hash-router) pattern this app already uses. If `dist/` doesn't exist (e.g. `npm test` runs before `npm run build` in CI), static serving is simply skipped rather than failing - the API works identically either way, tests are unaffected. Never run `vite dev`/`vite preview` in the beta environment; the container always serves the production `dist/` build through this same-origin Fastify route.

`public/sw.js`'s existing behavior is unchanged and remains correct here: `/api/**` requests are always network-only, never cached - authenticated responses, session state, subscriptions, evidence, Gmail state, and account state can never be persistently served stale from the service worker cache.

## Health and readiness

- `GET /api/v1/health` - liveness. "The process is running and can answer HTTP requests." No dependency checks, deliberately cheap. Returns `{"status":"ok"}` only - it used to also report which Gmail provider was configured, which was an unnecessary operational-configuration leak to an unauthenticated caller and has been removed.
- `GET /api/v1/health/ready` - readiness. For a `postgres`-backed runtime, verifies the connection pool can actually reach the database (`SELECT 1`) right now; for memory persistence (never used in production, see the fail-closed check above) it reduces to liveness. A failure returns `503 {"status":"unavailable"}` with the real error logged server-side only - never a connection string, driver error message, or stack trace in the response.

Neither endpoint requires authentication (by design - a load balancer/orchestrator needs to reach them without a session), and neither exposes secrets, database credentials, internal stack traces, or OAuth configuration.

## Google OAuth / Gmail configuration

Use the real, approved Google provider (`server/auth/googleProvider.js`) end to end - `GMAIL_PROVIDER=google` is required in production (enforced, see above). Configure the OAuth client's authorized redirect URIs in Google Cloud Console against the **actual deployed Cloud Run HTTPS origin**, using the application's own route definitions (do not assume paths from this document without checking `server/app.js`):

- Sign-in (OIDC) callback: `<PUBLIC_ORIGIN>` + the path `server/app.js` registers as `app.get('/api/v1/auth/google/callback', ...)`
- Gmail authorization callback: `<PUBLIC_ORIGIN>` + the path `server/app.js` registers as `app.get('/api/v1/sources/gmail/callback', ...)`

Scope is fixed by `TECH_DECISIONS.md`'s FEATURE-001 approved decisions and enforced in `server/auth/googleProvider.js`: `openid email profile` for sign-in, `https://www.googleapis.com/auth/gmail.readonly` for Gmail - read-only, least-privilege. Do not broaden either scope as part of this deployment work.

Do not enable real Gmail integration in a live environment until the configuration/security prerequisites in this document (Secret Manager populated, redirect URIs registered, health/readiness verified, database provisioned and migrated) are actually satisfied.

## Session security

Cookies use `HttpOnly`, `Secure`, and `SameSite=Lax` already (`server/security/session.js`, `TECH_DECISIONS.md`'s FEATURE-001 approved decisions) - `Secure` activates under the same `NODE_ENV=production || GMAIL_PROVIDER=google` condition as same-origin enforcement, both of which are true for this deployment. CSRF/same-origin enforcement on state-changing endpoints is unchanged by this work. Verify login, logout, account deletion (`DELETE /api/v1/account`), and Gmail disconnect/reconnect session invalidation against the real HTTPS deployment as part of deployed acceptance (see below) - this exercises `#41`'s approved retention/deletion policy and the `#41`/SEC-041-01/SEC-041-02 disconnect-recovery state machine for real, not just in tests.

## Cloud Run

Configuration applied by `.github/workflows/deploy.yml`'s `deploy` job (`gcloud run deploy`):

| Setting | Value | Rationale |
| --- | --- | --- |
| `--min-instances` | `0` | Scale-to-zero for the initial beta - cold starts are accepted (approved). |
| `--max-instances` | `CLOUD_RUN_MAX_INSTANCES` deploy variable (recommend starting at `3`) | Cost/scale-out protection *and* a direct bound on worst-case database connections (see "Database connection pool" above) - pick this value together with `DB_POOL_MAX`, not independently. |
| `--memory` | `512Mi` | Conservative; a Fastify/Node service at this scale does not need more, and Cloud Run bills by allocated resources. Revisit only with a demonstrated need. |
| `--cpu` | `1` | Default CPU throttling outside request processing (i.e. no `--no-cpu-throttling`) is left in place - the cheaper, scale-to-zero-friendly default, appropriate for the current low-traffic beta. |
| `--allow-unauthenticated` | set | The application has its own authentication (Google OIDC/sessions) - Cloud Run's own IAM-based invoker auth is not layered on top, matching a normal public web app. |
| Custom domain | Not configured | The Cloud Run-provided HTTPS origin is acceptable for the initial beta per the approved architecture - `PUBLIC_ORIGIN` and the OAuth redirect URIs are configured against it directly, not hardcoded anywhere in application code. |

## Cost

Target: **approximately $0/month** while the beta stays small, per Founder-approved cost policy.

| Item | Status |
| --- | --- |
| Cloud Run min instances | `0` (no idle/always-on cost) |
| Cloud Run resources | Conservative (`512Mi` / `1` CPU), no `--no-cpu-throttling` |
| Neon plan | Free tier |
| Load balancer | None (Cloud Run's built-in HTTPS endpoint is used directly) |
| VPC connector / NAT gateway | None - not needed; Cloud Run reaches Neon over the public internet with TLS, no private networking requirement exists for this scale |
| Enterprise observability | None - Cloud Logging's default ingestion (included in Cloud Run) is used as-is |

**No infrastructure in this plan is expected to create meaningful recurring charges** at initial beta scale. If actual usage approaches Cloud Run's or Neon free tier's limits, that is the trigger for a `FOUNDER COST APPROVAL REQUIRED` report before enabling anything paid (e.g. Neon compute beyond free tier, Cloud Run min-instances) - not a decision to make unilaterally.

## Backup / retention

`TECH_DECISIONS.md`'s MVP-BETA-004 approved policy: disconnect/delete operations complete synchronously (no separate 24-hour deletion job exists because none is needed at current beta scale), and any backup/analytics retention limit applies only to systems that don't yet exist in this repository (no backup pipeline, no analytics system).

**Neon's actual backup/point-in-time-restore behavior for the plan selected has not been verified against this deployment**, because no Neon project has been provisioned yet (see "Known limitations"). This is a real, open item:

> **TECHNICAL / PRODUCT DECISION REQUIRED (before #44 can be declared complete):** confirm the selected Neon plan's actual backup/PITR retention window once a project exists, and compare it against the approved retention policy (deleted data may remain only in encrypted disaster-recovery backups, for up to 30 days). If Neon's free-tier retention exceeds 30 days, or restoring from a backup could resurrect deleted user data beyond that window, this needs a Product Owner/Founder decision (accept the gap, document it as a known beta-scale limitation, or upgrade the plan) before public beta launch - not a decision this implementation makes on its own.

## CI/CD

- **`.github/workflows/ci.yml`** (existing, unchanged by this work): runs on every PR and push to `main` - unit/integration tests, PostgreSQL integration tests, application-runtime persistence tests, the Playwright smoke suite, the cross-browser suite, `npm run build`, and a whitespace check. This is the gate that already prevents a broken commit from reaching `main`.
- **`.github/workflows/deploy.yml`** (new, MVP-BETA-007): `workflow_dispatch`-only (see "Known limitations" for why this has not been run). Five sequential jobs:
  1. **`authorize`** (SEC-055-02, Security Manager remediation): hard-fails, before any other job runs, unless the dispatched ref is exactly the protected `main` branch - `workflow_dispatch` otherwise lets a human pick any branch, tag, or commit, and a feature branch whose tests happen to pass must never be able to reach production the same way an approved `main` commit can. This job also captures `github.sha` exactly once as `needs.authorize.outputs.sha`; every later job checks out, tags its image with, or labels its revision with that same immutable value, so a `main` push mid-run can never cause a later job to silently deploy a different commit than the one actually authorized.
  2. **`validate`** - re-runs the same test/build gate as `ci.yml`, against the exact authorized commit.
  3. **`build-and-push`** - builds the container, tags it with that exact commit SHA (never only `latest`), and pushes to Artifact Registry, authenticated as the deploy service account (see "Service accounts" above).
  4. **`migrate`** - runs `npm run migrate` against the real database, with `DATABASE_URL` fetched directly from Secret Manager (see "Database secret custody" above); a failure here blocks the `deploy` job entirely.
  5. **`deploy`** - `gcloud run deploy` with the new image, running the revision as the dedicated runtime service account (SEC-055-01, see "Service accounts" above), then smoke-tests the deployed revision's health/readiness endpoints, then verifies the deployed `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` pair against Google's real token endpoint (a bogus-refresh-token request that Google rejects with `invalid_client` for bad credentials or `invalid_grant` for good ones - no live user or browser needed). Added after a production incident where a wrong `GOOGLE_CLIENT_SECRET` reached production: the health/readiness checks never call Google at all, so that deploy reported fully healthy while every real sign-in was broken, and it was found only once a human tried to sign in.

  Every job but `authorize` requires the `production-beta` GitHub Environment, which should be configured with required reviewers for an additional human-approval gate beyond both the `workflow_dispatch` trigger and the branch restriction. Every third-party Action this workflow calls (`actions/checkout`, `actions/setup-node`, `google-github-actions/auth`, `google-github-actions/setup-gcloud`) is pinned to a reviewed full commit SHA rather than a mutable version tag (SEC-055-03) - a version comment sits beside each SHA so the intended release stays legible; bumping any of them is a deliberate, reviewed edit to that SHA, never something a tag's owner can silently change out from under this workflow.

Failing tests, at any stage, block the pipeline - there is no path from a red `validate` job to a deployed revision. Neither is there a path from a non-`main` ref to a deployed revision.

## Rollback

**Application rollback** (fast, low-risk):

1. Identify the current live revision's commit SHA: `gcloud run services describe <service> --region <region> --format 'value(metadata.labels.commit-sha)'`, or read it directly off the image tag Artifact Registry shows for the currently-serving revision (images are tagged by exact git SHA, never only `latest` - see "Artifact Registry" below).
2. Identify the previous known-good revision: `gcloud run revisions list --service <service> --region <region>` lists all revisions Cloud Run has retained, each still tagged to its own image/SHA.
3. Route traffic back without rebuilding: `gcloud run services update-traffic <service> --region <region> --to-revisions <previous-revision-name>=100`.
4. Verify: hit `/api/v1/health` and `/api/v1/health/ready` on the service URL, then re-run the "Deployed acceptance" checklist's core journey against it.

**Database rollback requires more care than application rollback and is not automatic.** Application rollback does not reverse any migration that already ran. Because this repository's migrations are written to be forward-compatible (additive, not destructive), the previous application revision should keep working correctly against a schema that has since gained new, unused-by-it columns/tables - but this is a property to actively preserve when writing future migrations, not a guarantee that holds automatically. If a specific migration is ever written in a way that breaks the previous revision (a genuinely breaking, non-additive change), that migration's own documentation must say so explicitly, and rollback for that release requires a deliberate, reviewed plan - not just "run the app rollback steps above."

## Logging

Fastify's structured JSON logger is enabled whenever `NODE_ENV=production` (or `GMAIL_PROVIDER=google`), which Cloud Logging ingests natively from stdout/stderr. Redaction (see "Secrets" above) is already active on that same condition. `server/app.js`'s logger config maps pino's level labels to Cloud Logging's own `severity` enum (`formatters.level`) - without this, pino's default numeric `level` field isn't recognized as a severity by Cloud Logging, and `severity>=ERROR`-style log queries silently return nothing even though errors are being logged (found and fixed during the incident referenced under "CI/CD" above). No additional logging infrastructure was built for this deployment - Cloud Run's default log ingestion is sufficient at this scale; see `#46` for the broader operational-readiness gate this deployment feeds into.

## Known limitations

This work was implemented in a sandboxed session with **no Google Cloud or Neon credentials of any kind** (no `gcloud` CLI, no service account, no Neon API token) and **no Docker daemon access** (the `docker` CLI is present but its daemon cannot start in that sandbox). Concretely, the following have NOT been done and remain for a human with the appropriate account access:

- No Google Cloud project, Cloud Run service, or Artifact Registry repository has been created.
- No Neon project or database has been created; the region pairing above is a documented recommendation, not a verified/provisioned choice.
- No real Google OAuth client (with the actual Cloud Run origin registered as a redirect URI) exists yet.
- `docker build`/`docker run` have not been executed against the real `Dockerfile` - its runtime file closure was instead verified by reproducing it directly on disk (see "Container" above), which is strong but not equivalent evidence.
- `.github/workflows/deploy.yml` has never actually fired - its `google-github-actions/auth`, Artifact Registry push, `npm run migrate` against a real `DATABASE_URL`, and `gcloud run deploy` steps (including the SEC-055-01 dedicated runtime service account, the SEC-055-02 `authorize` branch gate, and the SEC-055-04 in-step Secret Manager fetch) are unverified against real infrastructure. Neither service account described in "Service accounts" above has actually been created.
- The full "Deployed acceptance" checklist (real sign-in, real Gmail connect and scan, a real discovered receipt, restart persistence, correction, disconnect, delete account, all against the live Cloud Run + Neon environment) has not been executed, because no live environment exists to execute it against. Some of these steps (real sign-in with a controlled Google account, real Gmail authorization) should be performed by a human either way, not by an automated agent, regardless of credential access.
- Neon's actual backup/PITR retention behavior for the selected plan is unverified (see "Backup / retention" above - flagged as a `TECHNICAL / PRODUCT DECISION REQUIRED` item).

Everything else in this document - the fail-closed configuration validation, the health/readiness endpoints, the same-origin static-file serving, the conservative connection pool, the standalone migration script, the Dockerfile, and the deploy workflow's structure - is implemented, tested (`npm test`, `npm run test:postgres`, `npm run test:runtime`, `npm run test:smoke`, `npm run build`), and merged.

## Release gates

Before the first real deployment from this runbook:

- [ ] Google Cloud project created, billing linked (even for a $0-target beta, Cloud Run requires an active billing account).
- [ ] Neon project created in the region confirmed closest to `us-central1` at that time.
- [ ] Artifact Registry Docker repository created in `us-central1`.
- [ ] **Deploy service account** created and Workload Identity Federation configured for GitHub Actions to authenticate as it, with exactly: `roles/run.admin` on the Cloud Run service, `roles/artifactregistry.writer` on the Artifact Registry repository, `roles/secretmanager.secretAccessor` on each of the five runtime secrets, and `roles/iam.serviceAccountUser` granted on the runtime service account resource specifically (see "Service accounts" above) - nothing broader, no project-wide Editor/Owner role.
- [ ] **Runtime service account** created, separate from the deploy service account, holding only `roles/secretmanager.secretAccessor` on the same five runtime secrets - no other project roles. Its email is set as the `production-beta` Environment's `CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT` variable.
- [ ] Secret Manager populated with `DATABASE_URL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. No copy of `DATABASE_URL` is stored as a GitHub Environment Secret (see "Database secret custody" above).
- [ ] Google OAuth client created and its redirect URIs registered against the real Cloud Run origin (after the first deploy establishes what that origin is).
- [ ] `production-beta` GitHub Environment created with the variables/secrets `deploy.yml` references, and required reviewers configured.
- [ ] Branch protection on `main` (existing repository setting, unrelated to this deployment work) stays enabled - `deploy.yml`'s `authorize` job trusts that a commit on `main` went through the normal PR/CI gate, it does not re-verify that independently.
- [ ] A real `docker build .` succeeds locally or in CI before the first `workflow_dispatch` run.
- [ ] The "Deployed acceptance" checklist above is executed and passes.
- [ ] Independent Security review (public exposure boundary, environment validation, Secret Manager, OAuth configuration, token storage, session cookies, database TLS, logs, error responses, health endpoints, mock-provider prohibition, account isolation, account deletion) - not self-certified by whoever implements this.
- [ ] Independent QA validates the deployed candidate - implementation-agent testing does not substitute for this.
- [ ] Founder approves public-beta release.

## Current validation artifact

`npm run build` proves Vite can produce a static bundle; `npm test`, `npm run test:postgres`, and `npm run test:runtime` prove the application logic and PostgreSQL runtime behave correctly; `npm run test:smoke` proves the browser-facing behavior. None of these, individually or together, establish that the *deployed* environment is correct - only the "Deployed acceptance" checklist does that, and it has not yet been run (see "Known limitations"). Use [RELEASE_CHECKLIST.md](../quality/RELEASE_CHECKLIST.md) when a deployable environment is approved and live.
