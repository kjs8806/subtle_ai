# Design System

> **Owner:** Senior Product Designer
> **Status:** Current prototype reference
> **Canonical feature design:** [FEATURE-001](../product/features/FEATURE-001.md)
> **Last reviewed:** 2026-08-22

This document records the current system and approved extensions; it does not authorize a redesign or token refactor beyond what is recorded in [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md). `src/style.css` remains the implemented source.

## Foundations

**DES-018/019/020/021 (2026-08-22) replaced the editorial sage/coral/top-nav system with a purple SaaS-dashboard direction** (left sidebar nav, stat cards, purple accent), matching Product Owner-supplied reference screenshots. The sections below describe the current (post-DES-018) system; DES-010/013/014/016/017 above describe the superseded system and are kept for history, not as current guidance.

### Brand mark (DES-017, recolored by DES-018)

One SVG mark — a `--radius-md`-style rounded-square badge filled `--purple`, with a lowercase italic Georgia "s" in `--paper` (no accent dot) — is the single source of the logo. It is defined once in `src/main.js`'s `brandMark` and mirrored exactly in `public/icon.svg`, so the favicon, the in-app nav/footer mark, and the installed-app-icon are pixel-identical. The glyph is rendered as SVG `<text>` in the safe system font Georgia rather than the page's loaded webfont (Inter), because `public/icon.svg` is loaded standalone (favicon, OS home-screen icon, link previews) with no access to the page's `@import` — a webfont there would silently fall back and could visually diverge from the in-app copy.

### Type (DES-018)

- Interface and display: Inter (headings, body, buttons)
- Metadata/labels: DM Mono (eyebrows, mono badges, tabular figures)
- Playfair Display (DES-014/016) is retired - the new direction has no separate "editorial" typeface.

### Root tokens (DES-018)

A new purple/indigo hue family on a light-lavender ground, replacing the sage/coral system.

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#181a2a` | Primary text |
| Muted | `#6b7086` | Secondary information |
| Paper | `#f5f5fb` | Page background |
| Surface | `#ffffff` | Card/sidebar/dialog background |
| Border | `#e6e5f2` | Dividers and borders |
| Purple | `#6c5cf5` | Primary brand accent - active nav, primary buttons, stat icons |
| Purple deep / ink | `#5643e0` / `#4a3ad1` | Hover/active states and small purple text (AA contrast) |
| Purple soft | `#efebff` | Active-nav pill, badges, subtle accent fills |
| Coral / coral soft / coral ink | `#e2632f` / `#fdece2` / `#b84f22` | Attention/notice accents (price-increase style callouts) |
| Success / warning / danger (+ soft variants) | `#1a9c6b` / `#b3790c` / `#d6403f` | Status meaning - never color alone |

### Radius and elevation (DES-018)

| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | 6px | Small chips |
| `--radius-sm` | 10px | Buttons, form inputs, nav links |
| `--radius-md` | 14px | Evidence rows, correction panel |
| `--radius-lg` | 18px | Cards, panels, stat tiles |
| `--radius-xl` | 22px | Dialogs |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` | — | Resting, hover, and dialog elevation |

### Not yet centralized

Per-service brand accents (`.service-red/blue/navy/purple/green`) remain literal, category-identifying colors rather than semantic tokens — this is intentional (they identify a specific service, not the app's own palette) but still open per the Known gaps below. State never relies on color alone.

## Layout (DES-019)

- Persistent left sidebar (260px) with icon+label nav (Overview, Subscriptions, Worth your attention, Sources, Settings) down to 960px, below which it collapses into the existing slide-in mobile menu (`.mobile-topbar` + `#mobile-menu`, unchanged focus/`focusout`/Escape handling).
- Main content width: 1240px maximum.
- Responsive breakpoints: 1080px (dashboard grid to one column), 960px (sidebar → mobile drawer), 700px (stat grid/table to one column).
- Interactive targets: at least 44 × 44 CSS pixels.
- Mobile dialogs and Subscription Detail scroll without horizontal overflow.
- Any element toggled via the DOM `hidden` property must actually disappear - a global `[hidden]{display:none!important}` rule guards against author `display` rules on the same selector winning over the native `[hidden]` default (a real bug hit during DES-018's implementation: the "Confirmed by you" pill and the Disconnect Gmail button both stayed visible until this rule was added).

## Component anatomy and behavior

### Savings cards and feed items

Include priority/type, affected service(s), concise evidence-backed explanation, primary next action, secondary keep/dismiss action where approved, and quantified impact only when supported. Related subscriptions and evidence resolve by stable IDs.

### Subscription rows and detail

Rows present identity, plan/category, actionable signal, renewal, price/cadence, and affordance. Detail resolves exclusively by the selected subscription ID and groups identity, costs, provenance-aware analysis, history, evidence, confidence, correction, and manage actions. Missing values remain missing.

### Authorization disclosure

Before leaving for Google, explain what is requested, why, what may become a record, that access has not yet occurred, and that the source can be disconnected. Provide **Continue to Gmail** and **Not now**; prevent duplicate activation and restore focus on return.

### Source rows

Include source identity, connection/scan state text, real last-scan data only when available, security cue, and context-appropriate Connect, Retry, Reconnect, or Disconnect action.

### Processing, discovery, no-result, and recovery

- Scanning is non-blocking and the rest of the app remains navigable.
- Progress is indeterminate unless real progress data exists.
- Discovery ends with Review subscription and matching evidence.
- No-result means no qualifying receipts were found; it never claims the user has no subscriptions.
- Processing failure creates no partial or broken subscription row.
- Authorization and scanning failures have separate recovery actions.

## FEATURE-001 source-state contract

| State | Required presentation and behavior |
| --- | --- |
| Disconnected | “Not connected”; Connect action; no claim that Gmail was accessed. |
| Authorizing | “Waiting for Gmail”; prevent duplicate activation; cancellation returns to Disconnected. |
| Syncing | “Scanning receipts”; non-blocking, navigable, indeterminate unless real progress exists. |
| Connected | “Connected” and real last-scan/result data only when available. Authorization and scan status remain distinct. |
| Permission expired | “Reconnect needed”; Reconnect Gmail action; do not imply scanning can continue. |
| Scan error | Preserve connected state; explain receipts could not be scanned and offer retry. |

## Provenance and confidence

- **Confirmed from receipt:** the displayed field is directly supported by linked evidence.
- **Inferred from receipt:** the field is analysis, not a source fact, and includes confidence metadata.
- **Recommendation:** advice with its own ID, explanation, evidence IDs, related subscription IDs, and confidence metadata where applicable.

Confidence complements provenance; it never converts an inference into a fact. Provenance is needed at field level when fields within one record have different support. Evidence presentation uses the minimum relevant receipt context needed to explain a field or record and avoids unrelated sensitive content.

## Accessibility behavior

- Dialogs have semantic names, focus trapping, Escape dismissal where safe, and focus restoration.
- Async changes use an appropriate live region.
- Buttons use semantic elements and visible focus.
- Errors are programmatically associated and provide recovery where possible.
- Motion respects reduced-motion preferences.
- State, provenance, and confidence are understandable without color.

## Interaction and depth (DES-013, DES-018)

- Buttons, subscription rows, action cards, and the mobile menu all carry hover/active states; primary actions lift slightly on hover via `--shadow-sm`/`--shadow-md`/`--shadow-lg`.
- The sidebar nav is persistent (not sticky-on-scroll, since it's a fixed-height column); the active link shows a `--purple-soft` filled pill, not an underline.
- Dialogs fade, settle in, and use `--radius-xl` for a soft edge (skipped entirely under `prefers-reduced-motion`, consistent with the existing reduced-motion rule).
- The Gmail source status carries a small state dot (muted/amber-pulsing/green) alongside its text label — never color alone.
- `.empty-state` matches the card system with a dashed border.
- Cards, buttons, inputs, the subscription list, and service icons use the `--radius-*` scale instead of 0-radius rectangles.
- Monetary figures (stat cards, subscription price, cost grid, renewals) use `font-variant-numeric: tabular-nums` for column alignment.

## Known gaps

- Focus trapping/restoration and live announcements require implementation verification.
- Some current controls appear smaller than the 44 × 44 target.
- Field-level provenance is not consistently presented across Subscription Detail.
- The core app palette is now centralized as tokens (DES-018); per-service brand accents are still literal (see "Not yet centralized" above).
- Automated browser accessibility and responsive regression coverage are absent.
- Component rules are not implemented as a standalone reusable library.
- "Insights" (from the DES-018 reference) has no destination yet - intentionally left out of the sidebar (DES-019) rather than fabricated; revisit once a real feature is scoped.
