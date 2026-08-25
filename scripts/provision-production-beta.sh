#!/usr/bin/env bash
# Subtle AI - production-beta provisioning runbook (MVP-BETA-007, #44)
#
# NOT EXECUTED. This script has never been run against a real Google Cloud
# project or Neon database - it was written in a sandboxed implementation
# session with no gcloud CLI, no GCP/Neon credentials of any kind, and no
# Docker daemon access (see docs/engineering/DEPLOYMENT.md "Known
# limitations"). It is a literal, copy-pasteable transcription of that
# document's "Service accounts", "Database - Neon PostgreSQL", "Secrets",
# and "Release gates" sections, plus deploy.yml's exact variable/secret
# names - intended to save a human with real gcloud/Neon/GitHub access from
# re-deriving those steps from prose. Read it before running it. Run each
# numbered section in order; several sections require values only a human
# can supply (billing account, Neon connection string, real secret values,
# a real Google OAuth client) and are marked accordingly.
#
# Prerequisites on the machine running this script:
#   - gcloud CLI, authenticated as a user with Owner/Editor on the target
#     GCP organization or an existing project creator role
#   - gh CLI, authenticated with admin access to kjs8806/subtle_ai
#   - A Neon account (console.neon.tech) - Neon has no gcloud equivalent;
#     the database itself is provisioned through Neon's own console/CLI
#   - openssl (for generating SESSION_SECRET / TOKEN_ENCRYPTION_KEY)
#
# Exit on any error - do not continue past a failed step without
# understanding why it failed.
set -euo pipefail

# ---------------------------------------------------------------------------
# 0. Configuration - review and edit every value in this section before
#    running anything below it. Names/values here must match what
#    .github/workflows/deploy.yml actually reads (grep the file for
#    `vars.` / `secrets.` to re-verify if this script and the workflow
#    ever drift apart).
# ---------------------------------------------------------------------------
GCP_PROJECT_ID="subtle-ai-beta"                 # must be globally unique - change if taken
GCP_BILLING_ACCOUNT_ID="XXXXXX-XXXXXX-XXXXXX"   # `gcloud billing accounts list`
GCP_REGION="us-central1"                        # DEPLOYMENT.md "Region selection" - see that
                                                 # section before changing to
                                                 # northamerica-northeast1 (Canadian residency)
ARTIFACT_REGISTRY_REPO="subtle-ai"
CLOUD_RUN_SERVICE="subtle-ai"
CLOUD_RUN_MAX_INSTANCES="3"                     # DEPLOYMENT.md "Cloud Run" - pick together with
                                                 # DB_POOL_MAX (server/config/env.js), not alone

GITHUB_OWNER="kjs8806"
GITHUB_REPO="subtle_ai"
GITHUB_REPO_FULL="${GITHUB_OWNER}/${GITHUB_REPO}"

DEPLOY_SA_ID="subtle-ai-deploy"                 # build/push/deploy/migrate identity (SEC-055-01)
RUNTIME_SA_ID="subtle-ai-runtime"               # Cloud Run runtime identity only (SEC-055-01)
DEPLOY_SA_EMAIL="${DEPLOY_SA_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA_EMAIL="${RUNTIME_SA_ID}@${GCP_PROJECT_ID}.iam.gserviceaccount.com"

WIF_POOL_ID="github-actions-pool"
WIF_PROVIDER_ID="github-actions-provider"

# The five Secret Manager secret names deploy.yml references verbatim via
# --set-secrets and (for DATABASE_URL) `gcloud secrets versions access`.
# Do not rename these without updating deploy.yml to match.
SECRET_NAMES=(DATABASE_URL SESSION_SECRET TOKEN_ENCRYPTION_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET)

echo "==> Provisioning ${GCP_PROJECT_ID} (${GCP_REGION}) for ${GITHUB_REPO_FULL}"

# ---------------------------------------------------------------------------
# 1. Google Cloud project + billing + required APIs
# ---------------------------------------------------------------------------
gcloud projects create "${GCP_PROJECT_ID}" --name="Subtle AI Beta"
gcloud billing projects link "${GCP_PROJECT_ID}" --billing-account="${GCP_BILLING_ACCOUNT_ID}"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  --project="${GCP_PROJECT_ID}"

# ---------------------------------------------------------------------------
# 1b. Artifact Registry (Docker) repository
# ---------------------------------------------------------------------------
gcloud artifacts repositories create "${ARTIFACT_REGISTRY_REPO}" \
  --project="${GCP_PROJECT_ID}" \
  --repository-format=docker \
  --location="${GCP_REGION}" \
  --description="Subtle AI production-beta container images"

# ---------------------------------------------------------------------------
# 2. Deploy service account (GitHub Actions / WIF identity)
#    DEPLOYMENT.md "Service accounts": build/push/deploy/migrate only,
#    never used to run the application itself.
# ---------------------------------------------------------------------------
gcloud iam service-accounts create "${DEPLOY_SA_ID}" \
  --project="${GCP_PROJECT_ID}" \
  --display-name="Subtle AI deploy (GitHub Actions WIF)"

# ---------------------------------------------------------------------------
# 3. Cloud Run runtime service account (SEC-055-01)
#    Distinct identity - never used for build/push/deploy/migrate.
# ---------------------------------------------------------------------------
gcloud iam service-accounts create "${RUNTIME_SA_ID}" \
  --project="${GCP_PROJECT_ID}" \
  --display-name="Subtle AI Cloud Run runtime"

# ---------------------------------------------------------------------------
# 4. IAM roles - exactly what DEPLOYMENT.md "Service accounts" documents,
#    nothing broader. No project-wide Editor/Owner role for either SA.
# ---------------------------------------------------------------------------

# --- Deploy SA ---
# roles/run.admin on the project (deploying with --allow-unauthenticated
# requires run.services.setIamPolicy, which the narrower roles/run.developer
# does not grant - see DEPLOYMENT.md "Service accounts").
gcloud projects add-iam-policy-binding "${GCP_PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/run.admin" \
  --condition=None

# roles/artifactregistry.writer scoped to the one repository, not project-wide.
gcloud artifacts repositories add-iam-policy-binding "${ARTIFACT_REGISTRY_REPO}" \
  --project="${GCP_PROJECT_ID}" \
  --location="${GCP_REGION}" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/artifactregistry.writer"

# roles/iam.serviceAccountUser on the RUNTIME SA specifically (required for
# `gcloud run deploy --service-account` to deploy as it) - not on the
# project, not on the deploy SA itself.
gcloud iam service-accounts add-iam-policy-binding "${RUNTIME_SA_EMAIL}" \
  --project="${GCP_PROJECT_ID}" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
  --role="roles/iam.serviceAccountUser"

# --- Both SAs get secretmanager.secretAccessor, but ONLY on the five
# runtime secrets, granted per-secret after the secrets exist (section 6
# below) - never roles/secretmanager.admin, never project-wide. The loop
# there grants this role to both DEPLOY_SA_EMAIL and RUNTIME_SA_EMAIL.

echo "==> Deploy SA: ${DEPLOY_SA_EMAIL}"
echo "==> Runtime SA: ${RUNTIME_SA_EMAIL}"

# ---------------------------------------------------------------------------
# 5. Workload Identity Federation - restricted to this GitHub repository
#    AND the protected main branch specifically (belt-and-suspenders with
#    deploy.yml's own `authorize` job / SEC-055-02 - even a compromised
#    or misconfigured workflow_dispatch off another branch cannot mint a
#    usable token for this identity).
# ---------------------------------------------------------------------------
gcloud iam workload-identity-pools create "${WIF_POOL_ID}" \
  --project="${GCP_PROJECT_ID}" \
  --location="global" \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER_ID}" \
  --project="${GCP_PROJECT_ID}" \
  --location="global" \
  --workload-identity-pool="${WIF_POOL_ID}" \
  --display-name="subtle_ai main-only" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="assertion.repository == '${GITHUB_REPO_FULL}' && assertion.ref == 'refs/heads/main'"

WIF_POOL_NUMBER="$(gcloud iam workload-identity-pools describe "${WIF_POOL_ID}" \
  --project="${GCP_PROJECT_ID}" --location="global" --format='value(name)')"

# Bind the pool's principal set (scoped to this repo + main, enforced by
# the attribute-condition above) to the DEPLOY SA only - the runtime SA
# never authenticates via WIF, it is only ever assumed by Cloud Run itself.
gcloud iam service-accounts add-iam-policy-binding "${DEPLOY_SA_EMAIL}" \
  --project="${GCP_PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${WIF_POOL_NUMBER}/attribute.repository/${GITHUB_REPO_FULL}"

WIF_PROVIDER_RESOURCE="$(gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER_ID}" \
  --project="${GCP_PROJECT_ID}" --location="global" --workload-identity-pool="${WIF_POOL_ID}" \
  --format='value(name)')"

echo "==> GCP_WORKLOAD_IDENTITY_PROVIDER = ${WIF_PROVIDER_RESOURCE}"
echo "==> GCP_SERVICE_ACCOUNT = ${DEPLOY_SA_EMAIL}"
echo "    (both go into the production-beta GitHub Environment as SECRETS - section 10)"

# ---------------------------------------------------------------------------
# 6. Secret Manager - create the five runtime secrets, then grant BOTH
#    service accounts secretmanager.secretAccessor on each one individually
#    (never secretmanager.admin, never a project-wide grant).
#
#    *** HUMAN INPUT REQUIRED for every `echo -n 'REPLACE_ME'` below. ***
#    Do not run this section with the placeholders still in place - it
#    will create secrets containing the literal string REPLACE_ME.
# ---------------------------------------------------------------------------
for secret in "${SECRET_NAMES[@]}"; do
  gcloud secrets create "${secret}" --project="${GCP_PROJECT_ID}" --replication-policy="automatic"
done

# DATABASE_URL - the Neon POOLED connection string from section 8 below
# (sslmode=require is included by Neon by default - do not strip it).
echo -n 'REPLACE_ME_WITH_NEON_POOLED_CONNECTION_STRING' | \
  gcloud secrets versions add DATABASE_URL --project="${GCP_PROJECT_ID}" --data-file=-

# SESSION_SECRET - >= 32 random bytes (validateConfig rejects anything
# shorter, or equal to the local-development-only default).
openssl rand -base64 48 | \
  gcloud secrets versions add SESSION_SECRET --project="${GCP_PROJECT_ID}" --data-file=-

# TOKEN_ENCRYPTION_KEY - >= 32 characters (encrypts Gmail refresh tokens at
# rest - server/security/tokenVault.js).
openssl rand -base64 48 | \
  gcloud secrets versions add TOKEN_ENCRYPTION_KEY --project="${GCP_PROJECT_ID}" --data-file=-

# GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET - from the real OAuth client
# created in section 9 below (Console UI step - cannot be scripted).
echo -n 'REPLACE_ME_WITH_REAL_GOOGLE_CLIENT_ID' | \
  gcloud secrets versions add GOOGLE_CLIENT_ID --project="${GCP_PROJECT_ID}" --data-file=-
echo -n 'REPLACE_ME_WITH_REAL_GOOGLE_CLIENT_SECRET' | \
  gcloud secrets versions add GOOGLE_CLIENT_SECRET --project="${GCP_PROJECT_ID}" --data-file=-

for secret in "${SECRET_NAMES[@]}"; do
  gcloud secrets add-iam-policy-binding "${secret}" \
    --project="${GCP_PROJECT_ID}" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor"
  gcloud secrets add-iam-policy-binding "${secret}" \
    --project="${GCP_PROJECT_ID}" \
    --member="serviceAccount:${RUNTIME_SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor"
done

# ---------------------------------------------------------------------------
# 7. Neon PostgreSQL - NOT scriptable via gcloud (Neon is not a GCP
#    product). Do this in the Neon console (console.neon.tech) or via
#    `neonctl`, per DEPLOYMENT.md "Database - Neon PostgreSQL":
#
#    a. Create a Neon project in the region closest to ${GCP_REGION} -
#       VERIFY Neon's currently offered regions first, do not assume the
#       region DEPLOYMENT.md names is still correct or still closest.
#    b. Create a database and a role with least-privilege access to it -
#       NOT the Neon project's admin/owner role.
#    c. Copy the POOLED connection string (PgBouncer-backed - appropriate
#       for Cloud Run's elastic multi-instance model, see DEPLOYMENT.md
#       "Database connection pool") into DATABASE_URL above, section 6 -
#       never into a GitHub Environment Secret (SEC-055-04).
#    d. TLS is enforced by Neon's connection string (sslmode=require) by
#       default - do not strip it.
#
# ---------------------------------------------------------------------------
# 8. *** REQUIRED BEFORE PUBLIC BETA - DO NOT SKIP ***
#    DEPLOYMENT.md's open TECHNICAL/PRODUCT DECISION REQUIRED item:
#    confirm the selected Neon plan's actual backup/point-in-time-restore
#    retention window (Neon console -> project -> Settings -> Backup &
#    restore, or `neonctl` equivalent) and compare it against the
#    approved #41 policy: deleted data may remain ONLY in encrypted
#    disaster-recovery backups, for at most 30 days. If the plan's
#    retention exceeds 30 days, or a restore could resurrect deleted user
#    data beyond that window, STOP - this needs a Product Owner/Founder
#    decision (accept the gap and document it, or upgrade the plan)
#    before public beta launch. Do not declare #44 complete without this
#    being explicitly resolved one way or the other.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 9. Google OAuth client - Console UI step, NOT scriptable via a stable
#    gcloud command (gcloud's `iap oauth-brands`/`oauth-clients` commands
#    are for Identity-Aware Proxy, a different OAuth client type - do not
#    substitute them here).
#
#    Google Cloud Console -> APIs & Services -> Credentials -> Create
#    Credentials -> OAuth client ID -> Application type: Web application.
#    Authorized redirect URIs (exact paths from server/app.js, not
#    assumed - re-check that file if it has changed since this was
#    written):
#      https://<CLOUD_RUN_URL>/api/v1/auth/google/callback
#      https://<CLOUD_RUN_URL>/api/v1/sources/gmail/callback
#    <CLOUD_RUN_URL> is only known AFTER the first deploy (section 12) -
#    deploy once, note the URL Cloud Run assigns, register these two
#    redirect URIs, THEN populate GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET
#    (section 6) and set PUBLIC_ORIGIN/GOOGLE_OIDC_REDIRECT_URI/
#    GOOGLE_GMAIL_REDIRECT_URI (section 10) before re-running deploy.yml
#    a second time. The first deploy will fail its own fail-closed
#    config validation without real Google credentials present - that is
#    correct, expected behavior, not a bug to work around.
#    Scope must stay exactly: openid email profile (sign-in),
#    https://www.googleapis.com/auth/gmail.readonly (Gmail) - do not
#    broaden either scope.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# 10. GitHub `production-beta` Environment - secrets, variables, required
#     reviewers. Requires `gh` CLI authenticated with admin access to the
#     repository. The two WIF values come from section 5's output above.
# ---------------------------------------------------------------------------
gh api --method PUT "repos/${GITHUB_REPO_FULL}/environments/production-beta" \
  --field "deployment_branch_policy[protected_branches]=true" \
  --field "deployment_branch_policy[custom_branch_policies]=false"

# Required reviewers: GitHub's API needs numeric user/team IDs, not
# usernames - easier done once in the repo Settings UI (Settings ->
# Environments -> production-beta -> Required reviewers) than scripted.
echo "==> MANUAL STEP: add required reviewers to the production-beta Environment"
echo "    in the GitHub UI (Settings -> Environments -> production-beta)."

gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --env production-beta --repo "${GITHUB_REPO_FULL}" \
  --body "${WIF_PROVIDER_RESOURCE}"
gh secret set GCP_SERVICE_ACCOUNT --env production-beta --repo "${GITHUB_REPO_FULL}" \
  --body "${DEPLOY_SA_EMAIL}"
# DATABASE_URL is deliberately NOT set here (SEC-055-04) - Secret Manager
# is its sole authoritative store; migrate.yml's `migrate` job reads it
# directly via WIF, never from a GitHub Environment Secret.

gh variable set GCP_PROJECT_ID --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${GCP_PROJECT_ID}"
gh variable set GCP_REGION --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${GCP_REGION}"
gh variable set ARTIFACT_REGISTRY_REPO --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${ARTIFACT_REGISTRY_REPO}"
gh variable set CLOUD_RUN_SERVICE --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${CLOUD_RUN_SERVICE}"
gh variable set CLOUD_RUN_MAX_INSTANCES --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${CLOUD_RUN_MAX_INSTANCES}"
# SEC-055-01: the dedicated runtime identity, never the deploy SA.
gh variable set CLOUD_RUN_RUNTIME_SERVICE_ACCOUNT --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${RUNTIME_SA_EMAIL}"

# PUBLIC_ORIGIN / GOOGLE_OIDC_REDIRECT_URI / GOOGLE_GMAIL_REDIRECT_URI are
# NOT known until after the first deploy establishes the Cloud Run URL -
# see section 9's note. Set them here once that URL exists, e.g.:
#   PUBLIC_ORIGIN="https://subtle-ai-xxxxx-uc.a.run.app"
#   gh variable set PUBLIC_ORIGIN --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${PUBLIC_ORIGIN}"
#   gh variable set GOOGLE_OIDC_REDIRECT_URI --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${PUBLIC_ORIGIN}/api/v1/auth/google/callback"
#   gh variable set GOOGLE_GMAIL_REDIRECT_URI --env production-beta --repo "${GITHUB_REPO_FULL}" --body "${PUBLIC_ORIGIN}/api/v1/sources/gmail/callback"

# ---------------------------------------------------------------------------
# 11. A real `docker build .` - run this from a repo checkout at the exact
#     commit intended for the first deploy, on a machine with a working
#     Docker daemon (this sandboxed session never had one - see
#     DEPLOYMENT.md "Container" / "Known limitations"). This is a release
#     gate in its own right: deploy.yml's own build-and-push job runs the
#     equivalent build in CI, but confirming it locally first, once,
#     before the first real workflow_dispatch is what DEPLOYMENT.md's
#     Release gates checklist requires.
# ---------------------------------------------------------------------------
echo "==> MANUAL STEP: from a real Docker host, at the exact commit to deploy:"
echo "    docker build -t subtle-ai:local-verify ."
echo "    docker run --rm -p 8080:8080 -e PORT=8080 -e PERSISTENCE_PROVIDER=postgres \\"
echo "      -e DATABASE_URL=<a real reachable Postgres> subtle-ai:local-verify"
echo "    curl -sf http://localhost:8080/api/v1/health"

# ---------------------------------------------------------------------------
# 12. Trigger the deploy - from protected main only. deploy.yml's
#     `authorize` job independently re-verifies this and hard-fails
#     otherwise (SEC-055-02) - this --ref flag is not itself the security
#     control, just how you select the intended branch.
# ---------------------------------------------------------------------------
gh workflow run deploy.yml \
  --repo "${GITHUB_REPO_FULL}" \
  --ref main \
  --field confirm=deploy

echo "==> Watch it: gh run watch --repo ${GITHUB_REPO_FULL}"
echo "==> Or in the UI: https://github.com/${GITHUB_REPO_FULL}/actions/workflows/deploy.yml"

# ---------------------------------------------------------------------------
# 13. Post-deploy verification
# ---------------------------------------------------------------------------
echo "==> Verify the deployed revision matches the authorized commit:"
echo "    gcloud run services describe ${CLOUD_RUN_SERVICE} --project ${GCP_PROJECT_ID} --region ${GCP_REGION} \\"
echo "      --format 'value(metadata.labels.commit-sha)'"
echo "    (compare against: git -C <repo> rev-parse main)"
echo
echo "==> Health/readiness:"
echo "    URL=\$(gcloud run services describe ${CLOUD_RUN_SERVICE} --project ${GCP_PROJECT_ID} --region ${GCP_REGION} --format 'value(status.url)')"
echo "    curl -sf \"\$URL/api/v1/health\""
echo "    curl -sf \"\$URL/api/v1/health/ready\""
echo
echo "==> Then run the full 'Deployed acceptance' checklist in DEPLOYMENT.md"
echo "    by hand (real sign-in, real Gmail connect/scan, restart persistence,"
echo "    disconnect/purge, delete account, cross-account isolation) - these"
echo "    steps require a real, controlled Google account and should be"
echo "    performed by a human, not an automated agent, regardless of"
echo "    credential access."
