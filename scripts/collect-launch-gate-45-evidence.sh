#!/usr/bin/env bash
# Evidence-collection script for Security Manager Gate #45 (Security & Privacy
# Launch Gate). Run this from a shell with real `gcloud` authentication and
# `psql`/`curl` available (e.g. the Codespace used for prior production
# provisioning) - NOT from a sandboxed Claude Code session, which has no live
# GCP/Neon credentials.
#
# Every check below is read-only against GCP/Secret Manager/IAM, EXCEPT
# section 8 (CSRF/origin), which performs real POST requests against the live
# service using POST /api/v1/auth/logout - chosen deliberately because it is
# idempotent and safe to call repeatedly regardless of outcome (logging out a
# session that may or may not exist has no destructive side effect).
#
# This script NEVER prints a secret VALUE - only secret NAMES, IAM role
# bindings, and non-sensitive env var values. Section headers correspond to
# the numbered requirements in the #45 evidence request. Sections 4-7, 9, 10
# require a real browser + two real Google test accounts and are NOT
# automatable here (Google does not allow scripted/headless consent-screen
# completion) - see docs/security/LAUNCH_GATE_45_EVIDENCE.md for the manual
# protocol covering those.
set -euo pipefail

: "${GCP_PROJECT_ID:=subtle-ai-beta}"
: "${GCP_REGION:=us-central1}"
: "${CLOUD_RUN_SERVICE:=subtle-ai}"

hr() { printf '\n=== %s ===\n' "$1"; }

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud not found. Run this from an authenticated shell (e.g. the Codespace used for provisioning)." >&2
  exit 1
fi
if ! gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | grep -q .; then
  echo "ERROR: gcloud is not authenticated. Run 'gcloud auth login' first." >&2
  exit 1
fi

########################################
hr "1. DEPLOYED ARTIFACT IDENTITY"
########################################
SERVICE_JSON=$(gcloud run services describe "${CLOUD_RUN_SERVICE}" --project "${GCP_PROJECT_ID}" --region "${GCP_REGION}" --format=json)
SERVICE_URL=$(echo "${SERVICE_JSON}" | python3 -c "import json,sys; print(json.load(sys.stdin)['status']['url'])")
ACTIVE_REVISION=$(echo "${SERVICE_JSON}" | python3 -c "import json,sys; print(json.load(sys.stdin)['status']['latestReadyRevisionName'])")
COMMIT_SHA=$(echo "${SERVICE_JSON}" | python3 -c "import json,sys; print(json.load(sys.stdin)['metadata']['labels'].get('commit-sha','MISSING'))")
IMAGE_URI=$(echo "${SERVICE_JSON}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['spec']['template']['spec']['containers'][0]['image'])")

echo "Public URL:        ${SERVICE_URL}"
echo "GCP project:       ${GCP_PROJECT_ID}"
echo "Region:            ${GCP_REGION}"
echo "Service name:      ${CLOUD_RUN_SERVICE}"
echo "Active revision:   ${ACTIVE_REVISION}"
echo "Image URI:         ${IMAGE_URI}"
echo "Commit SHA label:  ${COMMIT_SHA}"

echo
echo "Traffic split (100% must point to the active revision above):"
gcloud run services describe "${CLOUD_RUN_SERVICE}" --project "${GCP_PROJECT_ID}" --region "${GCP_REGION}" \
  --format="table(status.traffic[].revisionName, status.traffic[].percent)"

echo
echo "--> Manually verify commit ${COMMIT_SHA} is reachable from protected main:"
echo "    git -C /path/to/subtle_ai merge-base --is-ancestor ${COMMIT_SHA} origin/main && echo 'on main' || echo 'NOT on main - FAIL'"

########################################
hr "2. CLOUD RUN CONFIGURATION"
########################################
RUNTIME_SA=$(echo "${SERVICE_JSON}" | python3 -c "import json,sys; print(json.load(sys.stdin)['spec']['template']['spec']['serviceAccountName'])")
echo "Runtime service account: ${RUNTIME_SA}"
echo "(Compare against your deploy service account below - MUST be different identities.)"

echo
echo "Non-sensitive env vars (values shown - none of these are secret):"
echo "${SERVICE_JSON}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
env = d['spec']['template']['spec']['containers'][0].get('env', [])
for e in env:
    if 'value' in e:
        print(f\"  {e['name']} = {e['value']}\")
"

echo
echo "Secret-backed env vars (NAMES + secret reference only - values never printed):"
echo "${SERVICE_JSON}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
env = d['spec']['template']['spec']['containers'][0].get('env', [])
for e in env:
    if 'valueFrom' in e and 'secretKeyRef' in e['valueFrom']:
        ref = e['valueFrom']['secretKeyRef']
        print(f\"  {e['name']} <- Secret Manager: {ref['name']}:{ref.get('key','latest')}\")
"

echo
echo "Min/max instances and scaling annotations:"
echo "${SERVICE_JSON}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
ann = d['spec']['template']['metadata'].get('annotations', {})
for k in ('autoscaling.knative.dev/minScale', 'autoscaling.knative.dev/maxScale'):
    print(f'  {k} = {ann.get(k, \"MISSING\")}')"

echo
echo "HTTPS reachability check:"
curl -sf -o /dev/null -w "  GET ${SERVICE_URL}/api/v1/health -> HTTP %{http_code} over TLS %{ssl_verify_result}\n" "${SERVICE_URL}/api/v1/health" || echo "  FAIL: request did not succeed"

echo
echo "--> Manually confirm against docs/engineering/DEPLOYMENT.md 'Required environment variables':"
echo "    NODE_ENV=production, GMAIL_PROVIDER=google, PERSISTENCE_PROVIDER=postgres,"
echo "    PUBLIC_ORIGIN equals ${SERVICE_URL} exactly (or the custom domain actually in use),"
echo "    GOOGLE_OIDC_REDIRECT_URI / GOOGLE_GMAIL_REDIRECT_URI are <that origin>/api/v1/auth/google/callback"
echo "    and <that origin>/api/v1/sources/gmail/callback respectively."

########################################
hr "3. IAM AND SECRET MANAGER"
########################################
: "${GCP_SERVICE_ACCOUNT:=}"   # deploy identity, e.g. subtle-ai-deploy@${GCP_PROJECT_ID}.iam.gserviceaccount.com
if [ -z "${GCP_SERVICE_ACCOUNT}" ]; then
  echo "Set GCP_SERVICE_ACCOUNT env var to the deploy service account email before running this section fully."
  echo "Falling back to listing all service accounts in the project for you to identify it:"
  gcloud iam service-accounts list --project "${GCP_PROJECT_ID}" --format="table(email,displayName)"
else
  echo "Deploy service account: ${GCP_SERVICE_ACCOUNT}"
fi
echo "Runtime service account: ${RUNTIME_SA}"

echo
echo "Project-level IAM bindings for the runtime service account (must show NO Editor/Owner):"
gcloud projects get-iam-policy "${GCP_PROJECT_ID}" \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:${RUNTIME_SA}" \
  --format="table(bindings.role)"

if [ -n "${GCP_SERVICE_ACCOUNT}" ]; then
  echo
  echo "Project-level IAM bindings for the deploy service account:"
  gcloud projects get-iam-policy "${GCP_PROJECT_ID}" \
    --flatten="bindings[].members" \
    --filter="bindings.members:serviceAccount:${GCP_SERVICE_ACCOUNT}" \
    --format="table(bindings.role)"
fi

echo
echo "Secret Manager: secret NAMES only (no versions, no values):"
gcloud secrets list --project "${GCP_PROJECT_ID}" --format="table(name)"

echo
echo "Per-secret IAM bindings (who can access which secret - values never shown):"
for secret in DATABASE_URL SESSION_SECRET TOKEN_ENCRYPTION_KEY GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET; do
  echo "  --- ${secret} ---"
  gcloud secrets get-iam-policy "${secret}" --project "${GCP_PROJECT_ID}" --format="table(bindings.role,bindings.members)" 2>/dev/null || echo "    (secret not found or no access)"
done

echo
echo "--> Manually confirm runtime SA has secretAccessor on exactly the 5 secrets above and nothing else,"
echo "    and deploy SA has run.admin + artifactregistry.writer + secretAccessor (5 secrets) + iam.serviceAccountUser"
echo "    scoped to the runtime SA resource (not project-wide) - see docs/engineering/DEPLOYMENT.md 'Service accounts'."

########################################
hr "8. CSRF / SAME-ORIGIN / CORS"
########################################
echo "Testing POST /api/v1/auth/logout with correct, missing, and foreign Origin."
echo "(Chosen because it is idempotent and safe regardless of outcome - no data is affected either way.)"

echo
echo "-- Correct origin (${SERVICE_URL}) --"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "${SERVICE_URL}/api/v1/auth/logout" \
  -H "Origin: ${SERVICE_URL}" -H "Content-Type: application/json"

echo
echo "-- Missing origin --"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "${SERVICE_URL}/api/v1/auth/logout" \
  -H "Content-Type: application/json"

echo
echo "-- Foreign origin (https://evil.example) --"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "${SERVICE_URL}/api/v1/auth/logout" \
  -H "Origin: https://evil.example" -H "Content-Type: application/json"

echo
echo "Expected per server/security/http.js enforceSameOrigin: correct origin proceeds to the route's own"
echo "auth check (401 if not logged in, which is fine - it means the origin check passed); missing/foreign"
echo "origin must return 403 {\"error\":{\"code\":\"invalid_origin\"}} BEFORE any route logic runs."

echo
echo "CORS headers on a cross-origin GET (should carry no Access-Control-Allow-* granting a foreign origin credentialed access):"
curl -s -D - -o /dev/null "${SERVICE_URL}/api/v1/health" -H "Origin: https://evil.example" | grep -i "access-control" || echo "  (no Access-Control-* headers present - expected for a same-origin-only API)"

########################################
hr "12. MOCK/TEST-PATH PROHIBITION"
########################################
echo "Deployed env vars already captured in section 2 - confirm NODE_ENV=production, GMAIL_PROVIDER=google,"
echo "PERSISTENCE_PROVIDER=postgres there. (server/config/env.js's validateConfig refuses to boot the process"
echo "at all if NODE_ENV=production and either of the other two is wrong - a running revision is itself proof.)"

echo
echo "Attempting to force mock behavior via client-supplied input (must have no effect):"
curl -s -o /dev/null -w "  POST /api/v1/sources/gmail/authorize with X-Gmail-Provider: mock header -> HTTP %{http_code} (expect 401, unauthenticated - never a mock connect)\n" \
  -X POST "${SERVICE_URL}/api/v1/sources/gmail/authorize" -H "X-Gmail-Provider: mock" -H "Origin: ${SERVICE_URL}"

echo
echo "Checking for any accidental test-only route exposure:"
for path in /api/v1/test /api/v1/debug /api/v1/_test /api/v1/mock; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "${SERVICE_URL}${path}")
  echo "  GET ${path} -> HTTP ${code} (expect 404)"
done

echo
echo "Rate-limit override check (E2E_RATE_LIMIT is a NODE_ENV=test-only override per server/security/http.js -"
echo "confirm it has no effect here by confirming NODE_ENV=production above; not independently testable via HTTP)."

########################################
hr "13. HEALTH / READINESS"
########################################
echo "-- GET /api/v1/health --"
curl -s -w "\nHTTP %{http_code}\n" "${SERVICE_URL}/api/v1/health"
echo
echo "-- GET /api/v1/health/ready --"
curl -s -w "\nHTTP %{http_code}\n" "${SERVICE_URL}/api/v1/health/ready"
echo
echo "Expected: health returns only {\"status\":\"ok\"}; ready returns {\"status\":\"ok\"} (DB reachable) or"
echo "503 {\"status\":\"unavailable\"} (DB unreachable) - neither body should ever contain a connection string,"
echo "provider name, or stack trace."

########################################
hr "11. LOGGING REVIEW (search commands - manual read required)"
########################################
cat <<'EOF'
Run each of these against a time window covering your manual test session (sections 4-10 below),
then eyeball the output for the listed disclosure category. A hit does not automatically mean a
leak - check the actual field/value. If a real secret value is found in output, rotate it
immediately in Secret Manager and report only the category, never the value, to the Security Manager.

  BASE='resource.type=cloud_run_revision AND resource.labels.service_name='"${CLOUD_RUN_SERVICE}"

  # All activity in the test window (adjust --freshness to your session length)
  gcloud logging read "$BASE" --project "${GCP_PROJECT_ID}" --freshness=30m --format=json > /tmp/gate45_logs.json

  # Search for each disclosure category (should all return NOTHING):
  grep -i 'authorization:' /tmp/gate45_logs.json          # Authorization headers
  grep -i 'set-cookie\|cookie:' /tmp/gate45_logs.json      # Cookie / Set-Cookie values (redact key already active in prod)
  grep -iE 'code=[A-Za-z0-9_-]{20,}' /tmp/gate45_logs.json # OAuth authorization codes
  grep -iE 'access_token|refresh_token' /tmp/gate45_logs.json # raw OAuth tokens
  grep -i 'postgres://\|postgresql://' /tmp/gate45_logs.json  # DATABASE_URL
  grep -i 'ciphertext' /tmp/gate45_logs.json               # encrypted token ciphertext (fine as an opaque
                                                            # blob reference; flag only if the raw bytes appear)
  grep -iE 'subject:|snippet:|receipt' /tmp/gate45_logs.json # Gmail message body content
  grep -i 'at file:///app' /tmp/gate45_logs.json           # stack traces (fine server-side; flag only if
                                                            # seen echoed back in an API response body instead)

Report PASS for each category with zero matches (or matches that are clearly not the actual sensitive
value, e.g. a field name in a log-shape comment), FAIL with only the category name for any real hit.
EOF

echo
echo "Evidence collection complete. Compile this output plus the manual protocol results from"
echo "docs/security/LAUNCH_GATE_45_EVIDENCE.md into the final report for the Security Manager."
