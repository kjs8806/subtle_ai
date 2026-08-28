# Gate #45 — Security & Privacy Launch Gate: Evidence Package

## Status of this document

**PARTIALLY EXECUTED.** Part A (sections 1, 2, 3, 8, 12, 13) has been run against the real deployed environment and results are recorded below. Part B (sections 4–7, 9, 10 — real browser + two Google test accounts) and the Neon retention check are still `PENDING`, along with one open discrepancy (traffic split, see "Open items" below) that should be resolved before this goes to the Security Manager. This was executed by a human with real `gcloud` access, pasted back into a sandboxed Claude Code session (which has no live GCP/Neon/browser credentials of its own) for compilation.

**This report is not a self-approval of #45.** Per the gate's own requirement, only the Security Manager issues the final verdict.

No secret *values* appear anywhere in this document or its output by design — only secret **names**, IAM **role names**, sanitized env var values, and pass/fail outcomes. If any step below turns up an actual secret value in logs or output, stop, rotate that credential in Secret Manager immediately, and record only the category of exposure here, never the value.

---

## Part A — Automated evidence

Run from an authenticated shell with real `gcloud` access (e.g. the Codespace already used for provisioning), not from a sandboxed Claude session:

```bash
export GCP_SERVICE_ACCOUNT='subtle-ai-deploy@subtle-ai-beta.iam.gserviceaccount.com'  # adjust to actual deploy SA email
./scripts/collect-launch-gate-45-evidence.sh > /tmp/gate45-automated-evidence.txt
```

This covers sections **1, 2, 3, 8, 11 (search commands), 12, 13** of the evidence request.

### 1. Deployed artifact identity

| Item | Value |
| --- | --- |
| Public URL | `https://subtle-ai-4jv5hmj22a-uc.a.run.app` (direct Cloud Run URL; `https://subtleai.net` is the mapped custom domain and canonical `PUBLIC_ORIGIN`, confirmed reachable in section 2) |
| GCP project | `subtle-ai-beta` |
| Region | `us-central1` |
| Service name | `subtle-ai` |
| `latestReadyRevisionName` | `subtle-ai-00009-tnc` |
| Image URI | `us-central1-docker.pkg.dev/subtle-ai-beta/subtle-ai/subtle-ai:0b4bfaff3da95df7f7f04fc7a3b2dede84c0e4e2` |
| Commit SHA label | `0b4bfaff3da95df7f7f04fc7a3b2dede84c0e4e2` |
| Commit reachable from protected `main`? | **PASS** — verified directly (`git merge-base --is-ancestor 0b4bfaf origin/main` → true) |
| 100% traffic on `latestReadyRevisionName`? | **FAIL — see "Open items" below.** Traffic is actually 100% on the older revision `subtle-ai-00005-2mn`; `subtle-ai-00009-tnc` (the revision `latestReadyRevisionName` reports, `Ready: True`, and the one our own post-deploy OAuth-credential check validated) is receiving 0% (`None` in the raw traffic table). |

### 2. Cloud Run configuration

| Check | Result |
| --- | --- |
| Runtime service account | `subtle-ai-runtime@subtle-ai-beta.iam.gserviceaccount.com` |
| Distinct from deploy identity? | **PASS** — deploy identity is `subtle-ai-deploy@subtle-ai-beta.iam.gserviceaccount.com`, a different service account (see section 3) |
| `NODE_ENV` | `production` — **PASS** |
| `GMAIL_PROVIDER` | `google` — **PASS** |
| `PERSISTENCE_PROVIDER` | `postgres` — **PASS** |
| `PUBLIC_ORIGIN` | `https://subtleai.net` — matches the deployed custom domain — **PASS** |
| `GOOGLE_OIDC_REDIRECT_URI` | `https://subtleai.net/api/v1/auth/google/callback` — matches `PUBLIC_ORIGIN` + the exact route in `server/app.js` — **PASS** |
| `GOOGLE_GMAIL_REDIRECT_URI` | `https://subtleai.net/api/v1/sources/gmail/callback` — **PASS** |
| Secrets are Secret Manager references, not plaintext | **PASS** — all five (`DATABASE_URL`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) resolve via `secretKeyRef` to `<name>:latest`, no `value` field |
| HTTPS reachable | **PASS** — `GET /api/v1/health` → `200` |
| `minScale` | annotation absent (Cloud Run's default, i.e. 0 / scale-to-zero) — matches the approved beta configuration (`--min-instances 0` in `deploy.yml`) |
| `maxScale` | `3` — matches `CLOUD_RUN_MAX_INSTANCES` in `deploy.yml` |

### 3. IAM and Secret Manager

| Item | Value |
| --- | --- |
| Deploy service account | `subtle-ai-deploy@subtle-ai-beta.iam.gserviceaccount.com` ("Subtle AI deploy (GitHub Actions WIF)") |
| Runtime service account | `subtle-ai-runtime@subtle-ai-beta.iam.gserviceaccount.com` ("Subtle AI Cloud Run runtime") |
| Runtime SA project-level bindings | **Empty** (no rows returned) — **PASS**, confirms no project-wide Editor/Owner/broad role; its only real grants are the per-secret `secretAccessor` bindings below |
| Deploy SA project-level bindings | **PENDING re-run** — the script's fallback path only listed service accounts because `GCP_SERVICE_ACCOUNT` wasn't exported before this run; re-run with `export GCP_SERVICE_ACCOUNT='subtle-ai-deploy@subtle-ai-beta.iam.gserviceaccount.com'` set to confirm `roles/run.admin`, `roles/artifactregistry.writer`, and `roles/iam.serviceAccountUser` scoped to the runtime SA resource specifically |
| Secret Manager secret names | `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY` — exactly the 5 expected, no extras — **PASS** |
| Per-secret IAM bindings | Every one of the 5 secrets grants `roles/secretmanager.secretAccessor` to exactly `subtle-ai-deploy@...` and `subtle-ai-runtime@...`, and no other principal — **PASS** |

### 8. CSRF / same-origin / CORS

Tested against the real production origin (`https://subtleai.net`), correcting an initial script bug that targeted the raw Cloud Run URL instead:

| Origin sent | Result | Expected | Verdict |
| --- | --- | --- | --- |
| Correct (`https://subtleai.net`) | `401` (unauthenticated — the route's own check, reached only after passing origin enforcement) | Pass through to route auth check | **PASS** |
| Missing | `403 invalid_origin` | Rejected before route logic | **PASS** |
| Foreign (`https://evil.example`) | `403 invalid_origin` | Rejected before route logic | **PASS** |
| Cross-origin CORS headers | None present | No `Access-Control-Allow-*` granting foreign-origin credentialed access | **PASS** |

**Overall: PASS.**

### 12. Mock/test-path prohibition

| Check | Result |
| --- | --- |
| `NODE_ENV`/`GMAIL_PROVIDER`/`PERSISTENCE_PROVIDER` correct | **PASS** (section 2) — `validateConfig` refuses to boot at all otherwise, so a running revision is itself proof |
| `X-Gmail-Provider: mock` header forcing mock behavior | **PASS** — `401` (unauthenticated), no mock connection made; the header has no effect |
| `/api/v1/test`, `/api/v1/debug`, `/api/v1/_test`, `/api/v1/mock` | **PASS** — all `404` |
| Rate-limit override (`E2E_RATE_LIMIT`) | Not independently HTTP-testable; **PASS by construction** — `server/security/http.js` only honors it when `NODE_ENV=test`, and section 2 already confirms `NODE_ENV=production` |

### 13. Health / readiness

| Endpoint | Result |
| --- | --- |
| `GET /api/v1/health` | `200 {"status":"ok"}` — generic, no config/secret leakage — **PASS** |
| `GET /api/v1/health/ready` | `200 {"status":"ok"}` — DB reachable, generic body — **PASS** |

### 11. Logging review

Search commands were provided; **results still PENDING** — these need to be run against the time window covering the Part B manual test session (sign-in, Gmail connect, scan, disconnect, delete-account), not in isolation, so there's real authentication/token/receipt activity in the log window to actually check. Re-run once Part B is executed.

### Open items from Part A — resolve before Security Manager review

1. **Traffic split (real finding, §1).** `subtle-ai-00009-tnc` is `latestReadyRevisionName`, `Ready: True`, and the revision our own post-deploy OAuth-credential check (added in PR #64) validated as having a working `GOOGLE_CLIENT_SECRET` at 08:19:12Z — but 100% of live traffic is still on the older `subtle-ai-00005-2mn`. `gcloud run deploy` (used verbatim in `deploy.yml`, no `--no-traffic`) atomically shifts traffic on success, and the "Deploy Cloud Run revision" step for the run that created `00009` (workflow run `33154367375`) reported `success` at 08:19:03Z — so traffic was almost certainly shifted correctly at that moment, and something moved it back afterward, outside that deploy. Functionally low-risk right now: PR #64 changed only `.github/workflows/deploy.yml` and documentation, no application code, so `00005` and `00009` serve byte-identical app behavior. Still needs resolving as a process-integrity question before sign-off:
   - Pull the audit trail: `gcloud logging read 'resource.type=cloud_run_revision AND resource.labels.service_name=subtle-ai AND protoPayload.methodName="google.cloud.run.v2.Services.UpdateService"' --project=subtle-ai-beta --freshness=6h --format='value(timestamp,protoPayload.authenticationInfo.principalEmail,protoPayload.request)'` to identify who/what moved traffic and when.
   - Fix: `gcloud run services update-traffic subtle-ai --to-latest --project=subtle-ai-beta --region=us-central1`.
   - **PENDING** — audit log not yet pulled, traffic not yet re-routed as of this writing.
2. **Deploy SA IAM bindings (§3).** Re-run the script with `GCP_SERVICE_ACCOUNT` exported to get the actual bindings table rather than the fallback service-account listing. **PENDING.**
3. **Repo identity check.** The evidence-collection commands were run from a local clone reporting `origin` as `https://github.com/kjs8806/subscription_app`, not `subtle_ai`. Confirm this is the same repository (e.g. a rename GitHub is redirecting) and not a stale/divergent clone, since section 1's commit-traceability claim depends on `origin/main` actually being the authoritative branch: `git remote -v` and compare the repo's actual name/id against `kjs8806/subtle_ai`. **PENDING.**

---

## Part B — Manual protocol (real browser, two Google test accounts)

Google does not allow scripted completion of its consent screen, so sections 4–7, 9, and 10 require a human clicking through the real flow. Use two Google accounts already added as OAuth consent screen **test users** (see the earlier test-user setup) — call them **User A** and **User B**. Use throwaway/test accounts, never real production users' data, for the destructive checks (9, 10).

Open the browser DevTools **Network** tab (persist logs, disable cache) before starting, so redirect chains and response headers are visible for the whole session.

### 4. Google OIDC (User A)

1. Navigate to the deployed origin (from Part A, section 1). Confirm landing page shows the Google sign-in control only.
2. Click **Continue with Google**, complete sign-in as User A.
3. Record:
   - Sign-in initiation: does `GET /api/v1/auth/google/start` return a `url` pointing at `accounts.google.com`? **PENDING**
   - Google consent/account screen reached? **PENDING**
   - Callback returns to the deployed origin (not `.run.app` if a custom domain is now canonical, not any other host)? **PENDING**
   - `GET /api/v1/session` while signed in → `{"authenticated": true, ...}`? **PENDING**
4. In a separate tab/request, call logout (`POST /api/v1/auth/logout`) and immediately re-check `GET /api/v1/session` → must show `authenticated: false`. **PENDING**
5. **Google Cloud Console → APIs & Services → Credentials** → the OAuth client in use: confirm its Authorized redirect URIs list contains **exactly** the deployed callback URI from Part A section 2 (`<PUBLIC_ORIGIN>/api/v1/auth/google/callback`), with no stray extra entries pointing elsewhere that shouldn't still be trusted. **PENDING**
6. Confirm the OAuth consent screen's requested scope for sign-in is exactly `openid email profile` (visible on Google's consent screen itself, or via the authorization URL's `scope` param in DevTools). **PENDING**

### 5. Session-cookie security

In DevTools Network tab, find the response to `GET /api/v1/auth/google/callback` (the redirect back from Google). Inspect its `Set-Cookie` response header(s) for `subtle_session`:

| Flag | Expected | Observed |
| --- | --- | --- |
| `Secure` | present | PENDING |
| `HttpOnly` | present | PENDING |
| `SameSite` | `Lax` | PENDING |
| `Path` | `/` | PENDING |
| `Domain` | absent (host-only, no cross-subdomain leakage) | PENDING |

Do not paste the cookie's actual value into the report — flag names/values only.

### 6. Gmail OAuth and token custody (User A)

1. From the Sources page, click **Connect Gmail** (or the equivalent "Continue with Gmail" flow), pick the **same** Google account as sign-in, grant access.
2. In DevTools, find the authorization URL Google was sent to (`GET /api/v1/sources/gmail/authorize`'s resulting redirect) — confirm its `scope` param is exactly `https://www.googleapis.com/auth/gmail.readonly`. **PENDING**
3. After granting access and landing back on Sources: confirm status shows **Connected**, and that the connected mailbox shown matches User A's sign-in email. **PENDING**
4. Trigger a real scan. Confirm at least one subscription/candidate is discovered (or confirm the mailbox's genuine empty state if it has no matching receipts — either is acceptable evidence the scan pipeline ran for real). **PENDING**
5. Trigger a new Cloud Run revision (or wait for a natural scale-to-zero + cold start) and reload the Sources/Subscriptions page as User A — confirm the discovered data is still present (proves it's DB-persisted, not held in server memory). **PENDING**
6. Database evidence — real schema (`migrations/001_feature_001.sql`, `005_feature_001_token_contract.sql`), never print `DATABASE_URL` or the ciphertext itself:
   ```bash
   export DATABASE_URL="$(gcloud secrets versions access latest --secret=DATABASE_URL --project=subtle-ai-beta)"
   psql "$DATABASE_URL"
   ```
   ```sql
   -- Resolve the test user's id from their sign-in email
   SELECT u.id FROM users u JOIN auth_identities ai ON ai.user_id = u.id WHERE ai.email = 'testuser@gmail.com';

   -- Confirm the connection is scoped to that user_id, and check token presence WITHOUT printing it
   SELECT user_id, authorization_state,
          (encrypted_refresh_token IS NOT NULL) AS has_encrypted_token,
          length(encrypted_refresh_token)       AS ciphertext_length
   FROM source_connections
   WHERE user_id = '<uuid-from-above>' AND provider = 'gmail';
   -- Expect: authorization_state = 'connected', has_encrypted_token = true, ciphertext_length > 0.
   ```
   Record only PASS/FAIL for "encrypted token present, no plaintext column/value anywhere". **PENDING**
7. Confirm via a `GET /api/v1/sources/gmail` response body (browser Network tab) that no token material — encrypted or otherwise — is ever present in an API response to the browser. **PENDING**

### 7. Account isolation (User A vs User B)

1. Sign in as User B in a **separate browser profile or incognito window** (so cookies don't collide with User A's session).
2. From User A's session, note a real resource id — e.g. a subscription id from `GET /api/v1/subscriptions`, a candidate id, an attention `itemKey`.
3. Using User B's session (same browser tab/profile as B, or `curl` with B's session cookie extracted from DevTools — never paste the cookie value into this report, only the HTTP result), attempt each of the following against User A's resource id:

   | Operation | Endpoint pattern | Expected | Observed |
   | --- | --- | --- | --- |
   | Read subscription | `GET /api/v1/subscriptions/:id` | 404 | PENDING |
   | Correct subscription | `PATCH /api/v1/subscriptions/:id` | 404 | PENDING |
   | Reject subscription | `POST /api/v1/subscriptions/:id/reject` | 404 | PENDING |
   | Confirm candidate | `POST /api/v1/subscriptions/candidates/:id/confirm` | 404 | PENDING |
   | Reject candidate | `POST /api/v1/subscriptions/candidates/:id/reject` | 404 | PENDING |
   | Dismiss attention item | `POST /api/v1/attention/:itemKey/dismiss` | (itemKey is scoped by construction — confirm dismissing A's key from B's session has no observable effect on A's list) | PENDING |
   | Read Gmail connection | `GET /api/v1/sources/gmail` | Returns B's own (disconnected) state, never A's | PENDING |
   | Disconnect Gmail | `POST /api/v1/sources/gmail/disconnect` | Acts only on B's own connection, never A's | PENDING |
   | Delete account | `DELETE /api/v1/account` | Deletes only B, never A (do not actually run this against a real account you want to keep — verify request-shape only, or use a throwaway account for the real call in section 10 below) | PENDING |

4. Repeat the critical read/correct/reject directions with A and B swapped, to confirm isolation holds symmetrically. **PENDING**
5. Confirm no response body in the above leaked any of User A's data (subscription details, email, etc.) to User B even inside an error payload. **PENDING**

### 9. Disconnect Gmail (User A, with real data present)

1. With Gmail connected and at least one Gmail-derived subscription/candidate present, click **Disconnect Gmail**.
2. Confirm the UI reports success only after a definitive outcome (not optimistically). **PENDING**
3. **Google side**: visit `myaccount.google.com/permissions` as User A and confirm Subtle AI's access has actually been revoked. **PENDING**
4. **Local connection state**: `GET /api/v1/sources/gmail` → status is disconnected. **PENDING**
5. **Encrypted credential removed**: re-run the DB query from section 6 step 6 — `authorization_state` should now be `revoked_pending_purge` (or a further-purged state) and `has_encrypted_token` should be `false` for this user. **PENDING**
6. **Gmail-derived data purged**: confirm Gmail-sourced subscriptions/evidence/candidates/corrections/attention items tied to that connection are gone from both the UI and the database, per the #41 purge policy:
   ```sql
   SELECT count(*) FROM subscriptions WHERE user_id = '<User A uuid>';
   SELECT count(*) FROM evidence WHERE user_id = '<User A uuid>';
   SELECT count(*) FROM subscription_candidates WHERE user_id = '<User A uuid>';
   SELECT count(*) FROM subscription_corrections WHERE user_id = '<User A uuid>';
   ```
   Compare against the same counts captured immediately before disconnecting. **PENDING**
7. **Account survives**: `GET /api/v1/session` still shows User A authenticated; the account itself was not deleted. **PENDING**
8. **Manual/non-Gmail data survives**: if User A has any manually-added subscription (not Gmail-sourced), confirm it's still present after disconnect. **PENDING**
9. **Scanning blocked until reconnect**: `POST /api/v1/sources/gmail/scan` → `409 source_not_connected`. **PENDING**
10. **User B unaffected**: confirm User B's own Gmail connection/data (if any) is untouched by User A's disconnect. **PENDING**
11. **Ambiguous revocation never reports false success**: this is a code-level guarantee (see `server/auth/googleProvider.js`'s `revokeConnection` — a thrown/network-level failure returns `revocation_ambiguous`, never `disconnected`) — confirm by reading the `POST /api/v1/sources/gmail/disconnect` response body's status field if a failure can be safely induced (e.g. temporarily revoking network access is not recommended against production; if not independently reproducible, mark as **code-reviewed, not live-reproduced** rather than fabricating a live test). **PENDING**

### 10. Delete Account (throwaway test account only)

Use a dedicated throwaway Google test account for this — **never** a real production user, and never User A or User B if either is needed for further testing.

1. Populate the throwaway account with representative data (sign in, connect Gmail, run a scan or add a manual subscription).
2. Delete the account through the deployed UI (Settings → Delete Account) or `DELETE /api/v1/account`.
3. Confirm all active sessions for that account are invalid immediately after — re-use of the pre-deletion session cookie against `GET /api/v1/session` returns `authenticated: false`. **PENDING**
4. Confirm via SQL that the user row and all user-scoped rows are gone, per the #41 deletion scope — **do not** paste row contents, just row counts before/after:
   ```sql
   SELECT count(*) FROM users WHERE id = '<throwaway uuid>';  -- expect 0
   SELECT count(*) FROM source_connections WHERE user_id = '<throwaway uuid>';  -- expect 0
   SELECT count(*) FROM subscriptions WHERE user_id = '<throwaway uuid>';  -- expect 0
   SELECT count(*) FROM evidence WHERE user_id = '<throwaway uuid>';  -- expect 0
   SELECT count(*) FROM subscription_candidates WHERE user_id = '<throwaway uuid>';  -- expect 0
   SELECT count(*) FROM subscription_corrections WHERE user_id = '<throwaway uuid>';  -- expect 0
   SELECT count(*) FROM sessions WHERE user_id = '<throwaway uuid>';  -- expect 0
   ```
   All of these should cascade automatically from the `users` row's `ON DELETE CASCADE` foreign keys (see `migrations/001_feature_001.sql`, `008_feature_002_corrections.sql`). **PENDING**
5. Sign in again with the same Google account afterward — confirm it creates a **fresh** account with no resurrected data from before deletion. **PENDING**
6. Confirm User A/User B remain completely intact throughout (row counts unaffected). **PENDING**

---

## Neon backup / PITR retention (open item from DEPLOYMENT.md)

`docs/engineering/DEPLOYMENT.md`'s "Backup / retention" section already flags this as an **unresolved, explicitly-called-out open item**: the approved policy caps backup/DR retention of deleted data at 30 days, but the actual Neon plan's PITR window has never been verified against a real provisioned project. Check now:

1. Neon Console → the production project → **Settings → Backup/Restore** (or `Restore` tab) → record the actual history-retention window in days.
2. Compare against the 30-day approved ceiling.

| | Value |
| --- | --- |
| Neon plan | PENDING |
| Actual PITR/backup retention window | PENDING |
| Within the 30-day approved policy? | PENDING |
| If not: Founder/Product Owner decision required per DEPLOYMENT.md — do not resolve this unilaterally | N/A unless retention exceeds policy |

---

## Completion Report

| Item | Result |
| --- | --- |
| Deployed URL | `https://subtle-ai-4jv5hmj22a-uc.a.run.app` (custom domain `https://subtleai.net` mapped and confirmed as `PUBLIC_ORIGIN`) |
| Active revision / commit SHA | `subtle-ai-00009-tnc` / `0b4bfaff3da95df7f7f04fc7a3b2dede84c0e4e2` — **PASS** on `main`-traceability, **FAIL/OPEN** on traffic (100% still on `00005-2mn` — see "Open items" above) |
| Cloud Run configuration | **PASS** (Part A §2) |
| IAM result | **PASS** on runtime SA; deploy SA bindings **PENDING re-run** (Part A §3) |
| Secret Manager result | **PASS** — exactly 5 secrets, `secretAccessor` scoped to exactly the 2 expected service accounts each (Part A §3) |
| OIDC result | PENDING (Part B §4) |
| Session-cookie result | PENDING (Part B §5) |
| Gmail OAuth result | PENDING (Part B §6) |
| Token-custody result | PENDING (Part B §6) |
| Account-isolation result | PENDING (Part B §7) |
| CSRF/CORS result | **PASS** (Part A §8) |
| Disconnect Gmail result | PENDING (Part B §9) |
| Delete Account result | PENDING (Part B §10) |
| Logging result | PENDING (Part A §11 — must run against the Part B test window, not in isolation) |
| Mock/test-path result | **PASS** (Part A §12) |
| Health/readiness result | **PASS** (Part A §13) |
| Neon backup/PITR retention result | PENDING (see section above) |
| Discrepancies found | (1) Traffic split not following `latestReadyRevisionName` — open, see above. (2) Deploy SA IAM bindings not yet captured (script re-run needed). (3) Local clone's `origin` reports as `kjs8806/subscription_app`, not `subtle_ai` — needs a one-line confirmation it's the same repo. |
| CI/deployment evidence links | Deploy workflow runs: PR #62 (session/OAuth-state fix), PR #63 (log severity + OAuth error detail), PR #64 (post-deploy credential verification) — see `.github/workflows/deploy.yml` run history in the repository's Actions tab. Runs `33150129466`, `33151173544`, `33152183869`, `33154367375` all `conclusion: success`. |

**Verdict: NOT SELF-APPROVED.** Part A's automated checks are largely clean (Cloud Run config, IAM/Secret Manager scoping, CSRF/origin enforcement, mock-path prohibition, health/readiness all PASS), but this is **not ready for Security Manager review yet** — the traffic-split discrepancy is unresolved, Part B (the parts requiring a real browser and two Google test accounts: OIDC, session cookies, Gmail OAuth/token custody, account isolation, disconnect, delete-account) has not been executed at all, and the Neon retention item remains open. Do not treat any PENDING row as passing, and do not read the PASS rows above as a full gate clearance on their own.
