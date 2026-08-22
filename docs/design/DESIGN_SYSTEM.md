# Design System

> **Owner:** Senior Product Designer
> **Status:** Current prototype reference
> **Canonical feature design:** [FEATURE-001](../product/features/FEATURE-001.md)
> **Last reviewed:** 2026-08-20

This document records the current system and approved extensions; it does not authorize a redesign or token refactor. `src/style.css` remains the implemented source.

## Foundations

### Type

- Display/editorial: Playfair Display
- Interface/body: Space Grotesk
- Metadata/labels: DM Mono

### Root tokens

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#20282b` | Primary text and dark actions |
| Muted | `#697276` | Secondary information |
| Paper | `#f5f4ee` | Page background |
| Cream | `#eeeadc` | Warm surfaces |
| Sage | `#c9d1bc` | Calm supporting state |
| Coral | `#e48667` | Emphasis and action accents |
| Line | `#d6d8cd` | Dividers and borders |

### Implemented app semantic palette

The app layer also uses direct semantic colors currently implemented in CSS: dark action/ink `#293732` and `#24302d`; app surface `#f7f8f4`; coral action `#d7785e`; positive `#78947a`/`#6c9272`; warning amber `#d3a34c`/`#a68136`; urgent coral `#c96d56`; plum `#94777e`; borders near `#dfe4dc`; and muted text near `#7d8781`/`#8b9590`.

These values document current behavior. Do not centralize, rename, or replace tokens without a separately reviewed design/technical change. State never relies on color alone.

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

## Interaction and depth (DES-013)

- Buttons, subscription rows, action cards, and the mobile menu all carry hover/active states; primary actions lift slightly on hover via `--shadow-sm`/`--shadow-md`/`--shadow-lg`.
- The global nav is sticky and stays opaque above scrolling content; the active link shows a coral underline.
- Dialogs fade and settle in on open (skipped entirely under `prefers-reduced-motion`, consistent with the existing reduced-motion rule).
- The Gmail source status carries a small state dot (muted/amber-pulsing/green) alongside its text label — never color alone.
- `.empty-state` (previously unstyled) now matches the card system with a dashed border.

## Known gaps

- Focus trapping/restoration and live announcements require implementation verification.
- Some current controls appear smaller than the 44 × 44 target.
- Field-level provenance is not consistently presented across Subscription Detail.
- Mobile navigation hides links without a documented replacement pattern.
- Tokens are not fully centralized and direct semantic colors remain in CSS.
- Automated browser accessibility and responsive regression coverage are absent.
- Component rules are not implemented as a standalone reusable library.
