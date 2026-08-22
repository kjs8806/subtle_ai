# Design System

> **Owner:** Senior Product Designer
> **Status:** Current prototype reference
> **Canonical feature design:** [FEATURE-001](../product/features/FEATURE-001.md)
> **Last reviewed:** 2026-08-22

This document records the current system and approved extensions; it does not authorize a redesign or token refactor beyond what is recorded in [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md). `src/style.css` remains the implemented source.

## Foundations

### Brand mark (DES-015)

One SVG mark (a bold rounded "S" stroke with a single coral accent dot, drawn in `src/main.js`'s `brandMark` and mirrored in `public/icon.svg`) is the single source of the logo — same shape at favicon, in-app nav/footer, and installed-app-icon size. Do not reintroduce a font-rendered glyph as the mark.

### Type (DES-014)

- Display/editorial: Fraunces (variable, weights 500/600/900, optical sizing on)
- Interface/body: Space Grotesk
- Metadata/labels: DM Mono

### Root tokens (DES-014)

Same sage/coral/paper hue family as before; values refined for contrast and centralized as tokens.

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#1f2924` | Primary text and dark actions |
| Ink soft | `#33423c` | Hover/active state for dark actions |
| Muted | `#5c6b64` | Secondary information |
| Paper | `#f7f8f3` | Page background |
| Sage | `#e3ebdd` | Calm supporting surface |
| Sage deep | `#b9c9ab` | Dividers/accents inside sage surfaces |
| Coral | `#c15f45` | Emphasis, decorative accents, backgrounds |
| Coral ink | `#9c4530` | Coral used as small text (AA contrast on white/paper) |
| Line | `#dde3d6` | Dividers and borders |

### Radius and elevation (DES-014)

| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | 6px | Service icons |
| `--radius-sm` | 10px | Buttons, form inputs |
| `--radius-md` | 16px | Cards, subscription list, mobile menu, cost grid |
| `--radius-lg` | 22px | Dialogs |
| `--shadow-sm` / `--shadow-md` / `--shadow-lg` | — | Resting, hover, and dialog elevation |

### Not yet centralized

Per-service brand accents (`.service-red/blue/navy/purple/green`) and the Gmail status dot's warning/success colors (`#a68136`, `#6c9272`) remain literal, category-identifying colors rather than semantic tokens — this is intentional (they identify a specific service or state, not the app's own palette) but still open per the Known gaps below. State never relies on color alone.

## Layout

- Content width: 1180px maximum.
- Existing responsive breakpoints: 900px and 650px, plus legacy landing-page behavior at 720px.
- Interactive targets: at least 44 × 44 CSS pixels.
- Mobile dialogs and Subscription Detail scroll without horizontal overflow.

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

## Interaction and depth (DES-013, DES-014)

- Buttons, subscription rows, action cards, and the mobile menu all carry hover/active states; primary actions lift slightly on hover via `--shadow-sm`/`--shadow-md`/`--shadow-lg`.
- The global nav is sticky and stays opaque above scrolling content; the active link shows a coral underline.
- Dialogs fade, settle in, and now use `--radius-lg` for a softer edge (skipped entirely under `prefers-reduced-motion`, consistent with the existing reduced-motion rule).
- The Gmail source status carries a small state dot (muted/amber-pulsing/green) alongside its text label — never color alone.
- `.empty-state` (previously unstyled) now matches the card system with a dashed border.
- Cards, buttons, inputs, the subscription list, and service icons use the `--radius-*` scale instead of 0-radius rectangles; the subscription list and renewals table are now bordered, radius-clipped white cards rather than flush dividers.
- Monetary figures (`--subscription-price`, spending summary, cost grid, renewals) use `font-variant-numeric: tabular-nums` for column alignment.

## Known gaps

- Focus trapping/restoration and live announcements require implementation verification.
- Some current controls appear smaller than the 44 × 44 target.
- Field-level provenance is not consistently presented across Subscription Detail.
- Mobile navigation hides links without a documented replacement pattern.
- The core app palette is now centralized as tokens (DES-014); per-service brand accents and the Gmail status colors are still literal (see "Not yet centralized" above).
- Automated browser accessibility and responsive regression coverage are absent.
- Component rules are not implemented as a standalone reusable library.
