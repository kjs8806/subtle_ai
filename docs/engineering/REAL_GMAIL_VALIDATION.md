# Real-Gmail Validation Runbook

> **Status:** Record of the first successful controlled real-Google → real-Gmail →
> evidence-backed-subscription validation run in the approved Codespaces
> environment (see [FEATURE-001_CODESPACES_APPROVAL.md](FEATURE-001_CODESPACES_APPROVAL.md)).
> **Scope:** Environment setup and Google Cloud Console configuration only. Does
> not itself constitute Security Review, QA, or Founder acceptance of FEATURE-001 -
> those remain separate gates.

This document is the setup runbook for running the controlled real-Google
sign-in → real-Gmail-authorization → real-Gmail-scan journey inside the
approved Codespace, plus the real defects that first run surfaced. It exists so
the next person (or agent) doing this doesn't have to rediscover any of it.

## 1. Google Cloud Console setup

These are one-time steps against a Google Cloud project with an OAuth 2.0
**Web application** client already created (Client ID + Client Secret).

1. **APIs & Services → Library → Gmail API → Enable.** Without this, Gmail's
   own endpoints (`gmail.googleapis.com/...`) return `403 accessNotConfigured`,
   including the profile-lookup call the identity check depends on (see §3).
2. **APIs & Services → OAuth consent screen → Audience/Test users → Add
   users.** Add the Google account that will be used for validation. While the
   consent screen is in "Testing" publishing status (the default, and correct
   for this controlled environment - do not publish/verify the app), sign-in
   is rejected with `403 access_denied` for any account not explicitly listed.
3. **APIs & Services → Credentials → (the OAuth client) → Authorized redirect
   URIs → Add URI**, for both:
   - the OIDC sign-in callback: `<PUBLIC_ORIGIN>/api/v1/auth/google/callback`
   - the Gmail-authorization callback: `<PUBLIC_ORIGIN>/api/v1/sources/gmail/callback`

   `<PUBLIC_ORIGIN>` is the Codespaces-forwarded HTTPS URL of the **client**
   dev server port (see §2), e.g.
   `https://<codespace-name>-5173.app.github.dev`. Google matches redirect URIs
   exactly; a missing trailing detail produces `Error 400: redirect_uri_mismatch`.
   Changes here can take a minute or two to propagate.

## 2. Codespace environment setup

1. Start PostgreSQL inside the Codespace (already approved for FEATURE-001
   validation; keep it off any publicly forwarded port beyond the Codespace's
   own "private" visibility):
   ```
   docker run -d --name subtle-ai-dev-pg -e POSTGRES_PASSWORD=postgres \
     -e POSTGRES_DB=subtle_ai_dev -p 55555:5432 postgres:16
   ```
2. Write a local, gitignored `.env` (never commit a populated one) with:
   - `PERSISTENCE_PROVIDER=postgres`, `DATABASE_URL` pointing at the container above
   - `GMAIL_PROVIDER=google`
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` from the Cloud Console client
   - `GOOGLE_OIDC_REDIRECT_URI`, `GOOGLE_GMAIL_REDIRECT_URI` matching §1.3 exactly
   - freshly generated `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` (32+ bytes each)
   - `HOST=0.0.0.0` - the default `127.0.0.1` is not reachable through
     Codespaces' forwarded port
   - `PUBLIC_ORIGIN` - see the tunnel-origin note below; it is **not** the same
     as the redirect URIs' origin
3. Run the server with `node --env-file=.env server/app.js` and the client with
   `npx vite --host 0.0.0.0`.

### The Codespaces tunnel normalizes `Origin` to `localhost`

GitHub Codespaces' port-forwarding tunnel (the `pf-signin`-gated proxy behind
`*.app.github.dev`) presents every request to the app as if it originated from
`http://localhost:<port>`, regardless of the browser's real external origin -
this is a deliberate compatibility behavior so local dev tooling that only
trusts `localhost` works unmodified through the forwarded URL. `Referer` is
passed through correctly; `Origin` is not.

This means the same-origin/CSRF check (`enforceSameOrigin`, active for
`GMAIL_PROVIDER=google` regardless of `NODE_ENV` - see
[DEPLOYMENT.md](DEPLOYMENT.md)) must be configured with
`PUBLIC_ORIGIN=http://localhost:<client-port>` for this environment, **not**
the public HTTPS forwarding URL used in the OAuth redirect URIs. The redirect
URIs (§1.3) and `PUBLIC_ORIGIN` are deliberately different values here.

Residual risk this creates: within this specific tunnel topology, the Origin
check can no longer distinguish the app's own traffic from a forged one by
Origin alone. The primary CSRF defense remains the session/state cookies'
`SameSite=Lax` attribute (browsers do not attach `SameSite=Lax` cookies to
cross-site POST/fetch requests) combined with the tunnel's own
per-Codespace-owner authentication gate. This is noted as an open item for the
Security Review Agent to formally assess; it does not apply outside this
Codespaces-tunnel topology (e.g. a real deployed HTTPS origin would not need
this adjustment).

## 3. Real defects this run found and fixed

None of these were reachable by the existing mock-provider test suite, since
the fake Gmail provider always returns a single canned message and never
exercises Google's actual API response shapes. All four are fixed in
`server/auth/googleProvider.js` / `server/gmail/messageAdapter.js`, with
regression tests added.

1. **Gmail identity lookup was structurally impossible as designed.** The
   Gmail-authorization identity check called Google's `tokeninfo` endpoint to
   read a `sub` claim, but a `gmail.readonly`-only access token carries no OIDC
   claims - `tokeninfo` returns no user-identifying field at all for it (only
   `azp`/`aud`/`scope`/`exp`). Requesting `openid`/`email` scope to get `sub`
   back would violate the approved exact-scope invariant. Fixed by calling
   Gmail's own `users/me/profile` endpoint (already covered by
   `gmail.readonly`, no new scope) and comparing the connected mailbox's email
   address against the signed-in identity's stored email instead of comparing
   subjects.
2. **`refreshAccessToken` returned a shape callers didn't read.** Google's
   token endpoint returns `access_token` (snake_case); the scan path reads
   `accessToken` (camelCase, matching only the fake provider's stub). Every
   real scan was silently sending `Authorization: Bearer undefined`. Fixed by
   normalizing the real provider's return value to include both.
3. **Concurrent per-message fetches hit Gmail's rate limit.** A real,
   actively-used inbox can match far more than one message for `receipt OR
   renewal`; fetching all of them via a single `Promise.all` triggered
   `429 rateLimitExceeded`. Fixed by batching detail fetches (5 at a time).
4. **Gmail's `Date` header isn't valid `timestamptz` input.** Real messages
   commonly carry an RFC 2822 date with a trailing zone annotation (e.g. `Sat,
   08 Aug 2026 14:23:10 +0000 (UTC)`), which PostgreSQL's `timestamptz` parser
   rejects outright. Fixed by normalizing to ISO 8601 in `messageAdapter.js`,
   preferring Gmail's own `internalDate` (server-assigned receipt time) over
   parsing the header text.

## 4. Outcome

With the above in place, the full journey - real Google sign-in
(`GMAIL_PROVIDER=google` fail-closed on missing `sub`), real Gmail
authorization (email-matched to the signed-in identity), real Gmail scan, and
evidence-backed subscription creation - completed successfully end to end
against a real inbox, persisting through the real PostgreSQL repository with
encrypted, server-side refresh-token custody. No merchant names, amounts, or
account identifiers from that run are recorded here or anywhere else in the
repository.

## 5. Before the next real-Gmail validation

Per [FEATURE-001_CODESPACES_APPROVAL.md](FEATURE-001_CODESPACES_APPROVAL.md),
a successful environment/setup run does not itself clear the acceptance gate.
Still required: Security Review Agent approval of the current controls
(including the `PUBLIC_ORIGIN`/tunnel finding in §2), independent QA
validation, passing CI on the reviewed commit, and explicit Founder
authorization.
