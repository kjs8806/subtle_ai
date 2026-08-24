# Accessibility & Cross-Browser QA — #43

> **Owner:** QA/Test Engineer (independent QA agent, #43)
> **Parent:** #38 MVP-BETA-001 Public Beta Readiness
> **Status:** Phase 1 in progress — **NOT READY for final #43 PASS**
> **Last reviewed:** 2026-08-24

This document is the working record for #43 (MVP-BETA-006). It tracks the
approved browser matrix, automated coverage, the manual test matrix, real-device
requirements, and defects found during QA's independent review. It supplements
`docs/quality/TEST_STRATEGY.md` and `docs/engineering/TESTING.md` rather than
replacing them.

Per the #43 sequencing rules: this document may be updated freely during Phase 1
(automation, manual test-case authoring, gap analysis). **Final #43 certification
requires re-running this matrix against the exact public-beta release-candidate
SHA after #39/#40/#41/#42 are integrated**, plus the real-device evidence below.
Passing on a development branch does not authorize closing #43.

## Baseline

- Repo inspected at: `main` @ `f56961f8641e35b97436d41a63fd7a24980ef0ff`, then
  QA automation from PR #50 (`qa/issue-43-cross-browser-gate`,
  `ec09e4b7e99fe9cee514460459dd6050b01b12ce`) merged in.
- `main` subsequently advanced to `913b67d` (PR #35, "QA: add Playwright browser
  smoke suite" — merged, not stale as this document originally assumed) and was
  merged into this branch. That PR split Playwright into two independent
  suites and changed real, load-bearing mock-provider behavior — see "Two
  Playwright suites" and "Resolved gap" below.
- #41 (Account & Data Controls / Delete Account) is **not yet merged to `main`**
  (open as PR #51). Delete-Account QA coverage below is written from the PR diff
  but cannot be executed or certified until it lands — see "Deferred to #41
  integration."

## Approved browser/support matrix

Per the Product Owner decision recorded on #43 (2026-08-24):

| Platform | Browser | Support level |
| --- | --- | --- |
| Desktop | Chrome (current stable) | Supported |
| Desktop | Edge (current stable) | Supported |
| Desktop | Firefox (current stable) | Supported — **not best-effort** |
| Desktop | Safari on macOS (current stable) | Supported |
| Mobile | Chrome on Android (current stable) | Supported |
| Mobile | Safari on iOS (current stable) | Supported |

Not guaranteed: legacy/EOL browsers, beta/dev/nightly channels, embedded/in-app
browsers, pixel-identical rendering across engines, native-app behavior. PWA
install UX may differ by platform — that alone is not a #43 defect as long as
the web application stays fully usable on that platform.

## Two Playwright suites

PR #35 (merged into `main`) added a second, independent Playwright suite
alongside this one, and split configuration so each suite only boots the dev
server(s) it needs:

| Suite | Config | Test dir | `npm run` | Owns |
| --- | --- | --- | --- | --- |
| Browser smoke suite | `playwright.config.js` | `test/e2e/` | `test:smoke` | General QA regression smoke coverage (not #43-specific) |
| #43 accessibility/cross-browser gate | `playwright.e2e.config.js` | `e2e/` | `test:e2e` | This document's scope |

Both now run in CI (`.github/workflows/ci.yml`), sequentially, with the job
halting on the first suite that fails so failure artifacts always reflect the
suite that actually broke. #43's automated evidence is `test:e2e` /
`playwright.e2e.config.js` only — the smoke suite is Chromium-only by design
and doesn't attempt cross-browser or accessibility coverage.

### Resolved gap — per-test mock identity isolation

The original #43 QA plan flagged: *"the current shared fixed mock account
constrains deterministic multi-engine mutating flows."* PR #35 fixes this at
the root: `server/gmail/fakeProvider.js`'s `createAuthorizationRequest` now
mints a fresh `mock-success:<uuid>` code on every real "Continue with Google"
click, so **every `signIn()` call now resolves to its own new, isolated
backend account** rather than sharing one fixed `mock-user`. Sign-in also no
longer auto-connects Gmail (previously a PD-011 demo shortcut) — a fresh
account now genuinely starts disconnected, matching a real first-time user.
Proven with real evidence in `test/browserIdentityIsolation.test.js` (distinct
codes/subjects/user UUIDs/sessions per sign-in; one identity's connect+scan
invisible to another). This suite's specs already used defensive
"disconnect-if-connected" guards rather than asserting the old behavior, so
**no test changes were needed** — verified by re-running the full suite
post-merge (see "Locally verified" below). Comments in `e2e/*.js` that
described the old shared-account/auto-connect assumption have been corrected.

## Automated coverage (this pass)

Suite: `e2e/` (Playwright), config `playwright.e2e.config.js`.

| Project | Engine | Scope |
| --- | --- | --- |
| `chromium-desktop` | Chromium | Full suite |
| `firefox-desktop` | Firefox | Full suite |
| `webkit-desktop` | WebKit | Full suite |
| `chromium-mobile` | Chromium (Pixel 7 profile) | `responsive.spec.js` |
| `webkit-mobile` | WebKit (iPhone 15 profile) | `responsive.spec.js` |

Spec files:

- `e2e/onboarding-flow.spec.js` — sign-in → Gmail disclosure → connect → scan →
  discovered subscription → evidence → disconnect → manual entry (MVP-BETA-002/003,
  #39/#40).
- `e2e/responsive.spec.js` — 360/390/768/1024px: no horizontal overflow, primary
  nav reachable (sidebar vs. hamburger), Add-subscription dialog fits viewport
  and closes on Escape (MVP-BETA-005, #42).
- `e2e/accessibility.spec.js` — **added this pass.** `@axe-core/playwright`
  scans (WCAG 2.0A/AA, 2.1AA, 2.2AA rule tags) against: landing/sign-in,
  first-run Overview (disconnected), Sources page + Gmail disclosure dialog,
  Subscriptions page + Add-subscription dialog, Subscription Detail + edit/remove
  dialogs (using a self-contained manually-added item so the spec doesn't depend
  on scan state or execution order), Worth your attention, Settings. A
  critical/serious axe finding fails the test; moderate/minor findings are
  logged to the test output for manual review, per the "zero violations is
  evidence, not certification" policy below.

CI (`.github/workflows/ci.yml`) now installs all three engines and runs both
`npm run test:smoke` and `npm run test:e2e` on PRs/pushes to `main` (`test:e2e`
wiring added in PR #50; reconciled with PR #35's smoke-suite CI steps in this
pass — see "Two Playwright suites" above).

**Environment limitation (this session):** this sandbox's network egress blocks
`cdn.playwright.dev` / `playwright.download.prss.microsoft.com`, so only the
pre-installed Chromium engine could be exercised locally; Firefox/WebKit engine
installs failed here with `403 request blocked`. This is a sandbox network-policy
restriction, not evidence of a product defect — GitHub Actions runners have open
egress and are expected to install all three engines. **Action for QA:** confirm
the first post-push CI run on this branch is green across all five projects
before treating the automated matrix as passing; do not infer Firefox/WebKit PASS
from this session's Chromium-only local run.

Locally verified this pass, `chromium-desktop` + `chromium-mobile` projects,
before merging PR #35's `main` changes in: the pre-existing suite
(`onboarding-flow.spec.js`, `responsive.spec.js`) is **25/25 green**. Re-run on
`chromium-desktop` alone *after* merging PR #35 (to confirm the identity-isolation
and Gmail-auto-connect changes didn't regress anything): still **13/13 green**
on that project. The `accessibility.spec.js` suite is **0/6 green** both before
and after the merge — every scanned surface fails on the confirmed contrast
defect below (DEFECT-A11Y-01), not on a test-infrastructure or merge problem;
see that section for per-page detail and its CI-gate consequence.

### Automated accessibility policy

Per #43: **zero axe violations does not equal accessibility certification.**
axe-core only catches a subset of WCAG failures (roughly 30-40% by design) —
contrast math, ARIA misuse, missing labels/landmarks, invalid roles. It cannot
judge logical tab order, focus-trap correctness, meaningful reading order, or
whether a live region announcement is actually useful. The manual matrix below
is required regardless of axe results.

## Manual test matrix (required before final PASS)

### Keyboard-only pass

Complete with keyboard only (Tab/Shift+Tab/Enter/Space/Escape/Arrow keys as
applicable), once per supported desktop browser:

- [ ] Sign in → land on Overview with visible focus on a sensible element.
- [ ] Reach every sidebar/mobile-menu destination via Tab, activate via Enter.
- [ ] Sources: open Gmail disclosure dialog — focus enters dialog, Tab cycles
      only within it (no escape to background), Escape closes and returns
      focus to the trigger button.
- [ ] Connect/scan/disconnect controls are reachable and operable without a
      pointer.
- [ ] Subscriptions: reach a row, open detail via Enter.
- [ ] Subscription Detail: open "This looks wrong"/"Edit subscription" dialog —
      same focus-trap/Escape/return-focus checks; every form field reachable in
      a logical order; Save is keyboard-activatable and disabled state is
      perceivable (not just visual dimming — check `aria-disabled`/`disabled`).
- [ ] "Not a subscription"/"Remove subscription" confirmation dialog — same
      focus checks; destructive action has a keyboard-reachable Cancel.
- [ ] Worth your attention: filter tabs operable via keyboard
      (`role="tablist"`/`role="tab"` — verify arrow-key or Tab semantics match
      what's implemented), attention detail dialog focus-trap/Escape, Dismiss
      reachable.
- [ ] Needs-review candidate row: Confirm/Reject buttons reachable and
      correctly labelled (`aria-label` includes the service name — verified in
      code, confirm behavior in a real screen reader/keyboard pass).
- [ ] Settings: Sign out reachable and operable.
- [ ] No state anywhere traps focus with no keyboard exit.

### Semantic / screen-reader review

- [ ] Each route has one `<h1>` and a logical heading structure under it.
- [ ] Landmarks: sidebar nav (`aside[aria-label="Primary"]`), page nav
      (`nav[aria-label="Product navigation"]`), main content region per page.
- [ ] Dialogs expose `role="dialog"`, `aria-modal="true"`, and an
      `aria-labelledby` pointing at a visible heading (spot-checked in code for
      Gmail disclosure, correction, reject, remove, attention-detail, add
      dialogs — confirm with a screen reader that the announced name matches).
- [ ] Form fields have associated `<label for>` (correction form, add-subscription
      form — confirmed in code); validation/error text
      (`[data-correction-error]`, `.form-error`) uses `role="alert"` — confirm
      it's actually announced on submit failure with a screen reader running.
- [ ] Scan status / async state: `[data-gmail-status]`,
      `[data-last-scan-results]` — confirm whether these are wired to a live
      region (`src/ui/accessibility.js` provides `createLiveRegion()`/
      `announce()` — confirm it's actually used for scan start/success/failure,
      not just visually updated).
- [ ] Severity/priority is never color-only: confirmed in code — every
      severity badge pairs a text label (High/Medium/Low) with color
      (`severityBadgeMarkup`), not color alone.

### Visual accessibility

- [ ] Text/control contrast — **see defects below; two systemic contrast
      failures found this pass.**
- [ ] Visible focus ring present everywhere (`:focus-visible` outline
      confirmed globally in `src/style.css:63`) — spot check no component
      overrides it away.
- [ ] 200% browser zoom: no clipped/overlapping content, reflow holds, dialogs
      stay usable.
- [ ] OS-level text-size increase (independent of browser zoom) doesn't clip
      content.
- [ ] `prefers-reduced-motion: reduce` respected — confirmed a media query
      exists at `src/style.css:628`; confirm the specific animations
      (scan-status pulse, dialog transitions) actually honor it.

### Mobile accessibility (real device — see below)

- [ ] Touch targets ≥44px for primary actions (menu button confirmed 44×44 in
      code at `src/style.css:108`; spot check other primary buttons/FAB).
- [ ] Dialogs remain reachable/scrollable with the software keyboard open.
- [ ] No control is hidden behind browser chrome (address bar, home indicator).
- [ ] Correction form and Add-subscription form stay usable with the keyboard
      open on a real device.

## Error/empty/loading state coverage

| State | Mock scenario / trigger | Automated | Manual |
| --- | --- | --- | --- |
| Zero results | `MOCK_GMAIL_SCENARIO=empty` | Not yet automated | Required |
| Ambiguous/needs-review | `MOCK_GMAIL_SCENARIO=ambiguous` | Partial (candidate lifecycle not yet in `e2e/`) | Required |
| Scan failure | `MOCK_GMAIL_SCENARIO=failure` (`listCandidateMessages` returns `null`) | Not yet automated — **verify server handles `null` without leaking a raw error/500 to the UI** | Required |
| OAuth/authorization failure | `code=mock-error` (`exchangeAuthorizationCode` throws) | Not yet automated | Required |
| OAuth cancelled | `code=mock-cancel` | Not yet automated | Required |
| Identity mismatch | **No mock scenario exists for this today** | Not possible with current mock provider | Flag to Product/Eng — needs a supported mock path or is real-provider-only |
| Session expired/invalid | Not yet automated | Required |
| Disconnect failure | Not yet automated | Required |
| Validation failure (correction form) | Not yet automated | Required |
| Account deletion failure | Deferred — #41 not merged | Deferred |

**Gap for hand-back:** the mock Gmail provider (`server/gmail/fakeProvider.js`)
has no scenario for "identity mismatch" (connecting a different Google account
than the one recorded). #43 requires this state to be distinguishable in the UI.
Recommend either a new `MOCK_GMAIL_SCENARIO` value the mock provider can
exercise in CI, or explicit confirmation this is real-provider/manual-only and
out of automated scope.

## PWA / security spot-check (this pass)

- Manifest (`public/manifest.webmanifest`): name/short_name = "Subtle AI" ✅,
  icon present ✅, `display: standalone` ✅.
- Service worker (`public/sw.js`): **critical security check passed** — the
  fetch handler explicitly bypasses the cache for any `/api/` request
  (`if (...pathname.startsWith('/api/')) { event.respondWith(fetch(...)); return }`),
  so authenticated API responses (session, subscriptions, evidence, sources,
  settings) are never served from the persistent cache. Only static app-shell
  assets are cached.
- Cache strategy note (non-blocking, Low): the SW uses cache-first for
  same-origin static GETs beyond the explicit `APP_SHELL` list, keyed by
  `CACHE_NAME = 'subtle-ai-shell-v2'`. A deploy that changes `index.html`/assets
  without bumping `CACHE_NAME` could briefly serve a stale shell to a returning
  visitor until the SW's `activate` cache-cleanup runs. Not a security issue;
  flagging for engineering awareness only.

## Defects found this pass

### DEFECT-A11Y-01 — Systemic AA contrast failure on "soft badge" color tokens (Medium)

**Where:** `src/style.css` — the `--warning`/`--warning-soft`,
`--danger`/`--danger-soft`, and `--coral`/`--coral-soft`(`-ink`) token pairs, as
used for text (not just background fills).

**What:** WCAG 2.2 AA requires ≥4.5:1 contrast for normal-size text. Computed
contrast (sRGB relative luminance, WCAG formula) for the actual token pairings
used as `color` on their paired `-soft` background:

| Usage | Foreground | Background | Ratio | Required | Result |
| --- | --- | --- | --- | --- | --- |
| `.severity-badge.severity-high` (Worth your attention — **High** severity, the most launch-critical tier) | `--danger` `#d6403f` | `--danger-soft` `#fdeae9` | **3.89:1** | 4.5:1 | Fail |
| `.severity-badge.severity-low`, `.uncertain-tag` (FEATURE-002 "Uncertain" candidate tag), `.conflict-notice` (FEATURE-002 correction conflict text) | `--warning` `#b3790c` | `--warning-soft` `#fdf1da` | **3.32:1** | 4.5:1 | Fail |
| `.severity-badge.severity-medium` | `--coral-ink` `#b84f22` | `--coral-soft` `#fdece2` | 4.37:1 | 4.5:1 | Fail (narrow) |
| `.nav-badge` (sidebar attention-count badge) | `#fff` | `--coral` `#e2632f` | **3.47:1** | 4.5:1 | Fail |
| `.brand-tagline`, `.st-empty` ("Price not provided"/"Not provided"), `.landing-signin-note` (Gmail consent/trust copy) | `--muted-soft` `#9a9fb3` | `--surface`/`--paper` (white/near-white) | **2.63:1** | 4.5:1 | Fail |

**Why it matters for #43 specifically:** these aren't decorative — they're the
severity indicator on FEATURE-003's Worth-your-attention cards (the release-critical
journey step "review FEATURE-003 attention information"), the "Uncertain"/conflict
indicators on FEATURE-002's correction/candidate-review flow, the sidebar's
unread-attention count, and the Gmail consent/trust copy #40 requires users to be
able to read and understand before authorizing.

**Not found failing:** `.danger-text`/`.form-error`/`danger-button` (danger token
directly against white, or white-on-danger) — these measure exactly 4.50:1,
compliant.

**Automated corroboration:** `e2e/accessibility.spec.js` (`@axe-core/playwright`,
`color-contrast` rule, `serious` impact) independently confirms this on every
surface scanned this pass — run against `chromium-desktop`, this branch, this
session:

| Surface | axe `color-contrast` nodes flagged |
| --- | --- |
| Landing / sign-in | 7 |
| Overview (first-run, disconnected) | 1 |
| Sources | 1 |
| Subscriptions (+ dialogs) | 2 |
| Worth your attention | 1 |
| Settings | 1 |

**Operational consequence — flagging for a human decision, not deciding it
myself:** because `expectNoSeriousA11yViolations` fails a test on any
`critical`/`serious` axe finding by design (see the policy comment in
`e2e/helpers.js`), **all 6 tests in `e2e/accessibility.spec.js` currently fail**,
and `npm run test:e2e` (wired into CI by PR #50) will therefore be **red on this
branch and on any branch it's merged into**, blocking every PR's required checks
until DEFECT-A11Y-01 is fixed. QA is not softening the assertion to force a green
build — that would hide a real, confirmed WCAG 2.2 AA failure — but merging this
suite into `main`'s required CI gate as-is will block unrelated PRs. Recommend
Product Owner/Tech Lead choose one before merge: (a) fix the contrast tokens
first (small, well-scoped change per the table above) and merge both together,
or (b) merge the suite now and accept CI is red until the follow-up fix lands.
Either way this is a release-authority decision, not QA's to make unilaterally.

**Severity:** Medium — text remains legible to most sighted users (this is a
contrast-ratio shortfall, not unreadable/invisible text), so QA is not blocking
Phase 1 progress on it, but it is a real WCAG 2.2 AA failure on release-critical
surfaces and should be fixed before final #43 PASS. Recommend Product
Designer/Tech Lead pick one: darken `--warning`/`--danger`/`--coral-ink` a few
steps, or lighten the paired `-soft` backgrounds, and re-run this contrast table.

**Owner:** hand back to Codex Builder/Implementation Engineer (styling-only
fix); Product Designer should confirm the resulting palette before it ships,
per `docs/design/DESIGN_SYSTEM.md`.

**Retest:** QA will re-run the contrast table and the axe scan (axe flags
`color-contrast` as a `serious`/`critical`-impact rule, so once corrected this
should also start failing this repo's own automated gate if it regresses) against
the fix commit SHA.

### Gap — no mock scenario for Gmail "identity mismatch"

See "Error/empty/loading state coverage" above. Not a defect in shipped
behavior — a coverage gap in the mock provider that blocks automating one of
#43's required states. Routed to Codex Builder/Tech Lead for a decision (add a
scenario vs. accept manual/real-provider-only coverage).

## Real-device / real-browser evidence (required before final PASS)

Playwright WebKit ≠ Safari macOS/iOS. Playwright Chromium ≠ Android Chrome. The
following must be recorded with browser, version, OS, version, device, candidate
SHA, and date, against the actual public-beta release-candidate commit:

- [ ] Chrome desktop, current stable
- [ ] Edge desktop, current stable
- [ ] Firefox desktop, current stable
- [ ] Safari macOS, current stable — **real Safari**
- [ ] Chrome on Android, current stable — **real Android device**
- [ ] Safari on iOS, current stable — **real iPhone**

Real-mobile focus areas: software keyboard/viewport resize, dialog scroll
behavior, sticky/fixed controls vs. browser chrome, touch targets, back
navigation, OAuth-return behavior where the environment permits.

## Deferred to #41 integration

#41 (Account & Data Controls) is open as PR #51, not yet on `main`. Once merged,
this gate must add and execute:

- Sign out / Disconnect Gmail / Delete Account as three distinct, independently
  testable operations.
- Delete Account: destructive-action styling, confirmation step, Cancel,
  loading/deleting state, error state, successful transition to signed-out
  state, and confirmation that protected UI (Overview/Subscriptions/Sources/
  Settings) is no longer reachable afterward.
- Automated coverage (`e2e/`) and an axe scan of the deletion confirmation
  dialog, per the QA plan's original automated-accessibility target list.
- Cross-account isolation remains primarily #41's backend/security testing
  responsibility; #43 covers only the supported-browser/accessibility surface
  of these controls.

## Exit policy (unchanged from the #43 QA plan)

#43 stays **FAIL / NOT READY** until: the exact release-candidate SHA has a
green automated browser matrix in CI (all five Playwright projects, verified on
GitHub Actions, not just this local Chromium-only run); no unresolved
Critical/High accessibility or browser defect remains (DEFECT-A11Y-01 is Medium
today — re-assess if it isn't fixed by the time Phase 2 starts); the manual
keyboard/semantic/visual matrix above is executed and recorded; real Safari
macOS, Safari iOS, and Android Chrome evidence is on file; and Known
Medium/Low issues are documented (this file) rather than silently accepted.
