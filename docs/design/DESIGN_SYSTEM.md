# Design System

> **Owner:** Senior Product Designer
> **Status:** Current prototype reference
> **Last reviewed:** 2026-08-20

This document records the current system; it does not authorize a visual redesign. Implementation details remain in `src/style.css`.

## Foundations

### Type

- Display/editorial: Playfair Display
- Interface/body: Space Grotesk
- Metadata/labels: DM Mono

### Core tokens

| Token | Value | Use |
| --- | --- | --- |
| Ink | `#20282b` | Primary text and dark actions |
| Muted | `#697276` | Secondary information |
| Paper | `#f5f4ee` | Page background |
| Cream | `#eeeadc` | Warm surfaces |
| Sage | `#c9d1bc` | Calm supporting state |
| Coral | `#e48667` | Emphasis and action accents |
| Line | `#d6d8cd` | Dividers and borders |

Use the semantic palette already defined in `src/style.css`. State must never rely on color alone.

## Layout

- Content width: 1180px maximum.
- Existing responsive breakpoints: 900px and 650px.
- Interactive targets: at least 44 × 44 CSS pixels.
- Mobile dialogs and Subscription Detail must scroll without horizontal overflow.

## Component families

- Global navigation and active-tab state.
- Summary and insight cards.
- Ranked savings-feed items and actions.
- Subscription rows, status labels, cost views, and overflow actions.
- Monthly/annual segmented controls.
- Subscription Detail and manual-entry dialogs.
- External-authorization disclosure.
- Data-source rows and connection/scanning states.
- Provenance and confidence indicators.
- Empty, loading, error, cancelled, reconnect, and success patterns.

## Behavior standards

- Dialogs have semantic names, focus trapping, Escape dismissal where safe, and focus restoration.
- Async state changes use an appropriate live region.
- Buttons use semantic elements and visible focus states.
- Errors are associated with the affected control and include a recovery action when possible.
- Motion respects reduced-motion preferences.
- Source states follow [FEATURE-001](../product/features/FEATURE-001.md) and [UX principles](UX_PRINCIPLES.md).

## Known gaps

- Component rules are not yet implemented as a standalone reusable library.
- Automated browser accessibility and responsive regression coverage are not yet present.
- Token naming in CSS may require later normalization without changing appearance.
