# Gate #45 — Security & Privacy Launch Gate: Evidence Package

## Status of this document

**NOT YET EXECUTED.** This is the evidence-collection protocol and report template, prepared by the Implementation Engineer. It was authored in a sandboxed session with no live `gcloud`, Neon, or browser/OAuth credentials — nothing below has actually been run against the deployed environment yet. Someone with real access must execute Part A (script) and Part B (manual protocol), record the actual results in place of the `PENDING` placeholders, and only then is this ready for the Security Manager's independent review.

**This report is not a self-approval of #45.** Per the gate's own requirement, only the Security Manager issues the final verdict.

No secret *values* appear anywhere in this document or its output by design — only secret **names**, IAM **role names**, sanitized env var values, and pass/fail outcomes. If any step below turns up an actual secret value in logs or output, stop, rotate that credential in Secret Manager immediately, and record only the category of exposure here, never the value.

---

## Part A — Automated evidence

Run from an authenticated shell with real `gcloud` access (e.g. the Codespace already used for provisioning), not from a sandboxed Claude session:

```bash
export GCP_SERVICE_ACCOUNT='subtle-ai-deploy@subtle-ai-beta.iam.gserviceaccount.com'  # adjust to actual deploy SA email
./scripts/collect-launch-gate-45-evidence.sh > /tmp/gate45-automated-evidence.txt
```

This covers sections **1, 2, 3, 8, 11 (search commands), 12, 13** of the evidence request. Paste the full output below:

```
PENDING — paste scripts/collect-launch-gate-45-evidence.sh output here
```

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
6. Database evidence (run against the real production `DATABASE_URL`, from a shell with Neon access — **never** print the connection string itself):
   ```sql
   -- Confirm the Gmail connection is scoped to a real user_id, not a global row
   SELECT user_id, status, connected_at FROM gmail_connections WHERE user_id = '<User A's uuid>';

   -- Confirm no plaintext refresh token column exists / is populated - only ciphertext
   -- (do not select or paste the ciphertext column's actual bytes into this report;
   -- confirm only that the column is non-null and that no separate plaintext column exists)
   SELECT user_id, (refresh_token_ciphertext IS NOT NULL) AS has_encrypted_token
   FROM gmail_connections WHERE user_id = '<User A's uuid>';
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
5. **Encrypted credential removed**: re-run the DB query from section 6 step 6 — the encrypted token column should now be null/absent for this user. **PENDING**
6. **Gmail-derived data purged**: confirm Gmail-sourced subscriptions/evidence/candidates/corrections/attention items tied to that connection are gone from both the UI and (via SQL) the database, per the #41 purge policy. **PENDING**
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
4. Confirm via SQL that the user row and all user-scoped rows (subscriptions, evidence, candidates, corrections, attention items, gmail_connections) are gone, per the #41 deletion scope — **do not** paste row contents, just row counts before/after. **PENDING**
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
| Deployed URL | PENDING (Part A §1) |
| Active revision / commit SHA | PENDING (Part A §1) — must be verified as reachable from protected `main` |
| Cloud Run configuration | PENDING (Part A §2) |
| IAM result | PENDING (Part A §3) |
| Secret Manager result | PENDING (Part A §3) |
| OIDC result | PENDING (Part B §4) |
| Session-cookie result | PENDING (Part B §5) |
| Gmail OAuth result | PENDING (Part B §6) |
| Token-custody result | PENDING (Part B §6) |
| Account-isolation result | PENDING (Part B §7) |
| CSRF/CORS result | PENDING (Part A §8) |
| Disconnect Gmail result | PENDING (Part B §9) |
| Delete Account result | PENDING (Part B §10) |
| Logging result | PENDING (Part A §11 — search commands; requires human read of output) |
| Mock/test-path result | PENDING (Part A §12) |
| Health/readiness result | PENDING (Part A §13) |
| Neon backup/PITR retention result | PENDING (see section above) |
| Discrepancies found | PENDING |
| CI/deployment evidence links | Deploy workflow runs: PR #62 (session/OAuth-state fix), PR #63 (log severity + OAuth error detail), PR #64 (post-deploy credential verification) — see `.github/workflows/deploy.yml` run history in the repository's Actions tab |

**Verdict: NOT SELF-APPROVED.** This package is prepared for the Security Manager's independent review per the #45 gate requirement. Do not treat any PENDING row as passing.
