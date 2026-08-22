# Design Decision Log

> **Owner:** Senior Product Designer
> **Status:** Append-only accepted decisions
> **Canonical FEATURE-001 design:** [FEATURE-001](../product/features/FEATURE-001.md)
> **Last reviewed:** 2026-08-22

| ID | Status | Decision | Rationale | Source | Date |
| --- | --- | --- | --- | --- | --- |
| DES-001 | Accepted | Keep the primary experience action-first. | The product must help users decide what to do next. | [UX principles](UX_PRINCIPLES.md) | 2026-08-20 |
| DES-002 | Accepted | Use automatic contextual intelligence instead of chat-first navigation. | Reduces interaction overhead and generic insight noise. | [PRODUCT](../product/PRODUCT.md) | 2026-08-20 |
| DES-003 | Accepted | Place minimal inspectable evidence with the affected subscription. | Supports trust without exposing irrelevant source content. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-004 | Accepted | Use Confirmed from receipt, Inferred from receipt, and Recommendation provenance. | Prevents analysis from appearing as source fact. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-005 | Accepted | Resolve detail and related content through the selected stable subscription ID. | Prevents mismatched identity, evidence, and recommendations. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-006 | Accepted | Keep authorization, connection, scanning, result, and error states distinct. | A source may remain connected when scanning fails. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-007 | Accepted | Use explicit in-app disclosure before external Gmail authorization. | Preserves informed consent and neutral cancellation. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-008 | Accepted | End discovery success in subscription and evidence review. | Connection alone does not prove user value. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-009 | Accepted | Keep Gmail within Data sources; add no Gmail navigation tab. | Preserves Overview, Subscriptions, and Savings information architecture. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-010 | Superseded by DES-014 | Retain responsive installable PWA delivery and the editorial/calm visual language. | Extends the current experience without an unapproved redesign. | [Design system](DESIGN_SYSTEM.md) | 2026-08-20 |
| DES-011 | Accepted | Use `APP_CONFIG.name` for visible branding. | Keeps the brand easy to change. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-012 | Accepted | Never fabricate progress, counts, timestamps, confidence, or success. | Feedback must remain trustworthy. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-013 | Accepted | Add interaction feedback (hover/active/focus states, elevation, sticky nav, dialog motion, connection-status indicator) using only existing tokens and typography; no palette, radius, or layout redesign. | Buttons, rows, and dialogs had no hover/active states or depth, which reads as unfinished against current interface conventions; DES-010 and UX principle 13 rule out a broader redesign. | [DESIGN_SYSTEM](DESIGN_SYSTEM.md) | 2026-08-22 |
| DES-014 | Partially superseded by DES-016 (typeface only) | Supersede DES-010: refine the root color tokens for contrast (same sage/coral/paper hue family, no hue-family change), replace Playfair Display with Fraunces for display type, and introduce a radius/elevation system (buttons, cards, dialogs, subscription list, service icons) instead of 0-radius rectangles. | Explicit Product Owner request to bring execution to current interface conventions; the flat/sharp/serif-editorial treatment under DES-010 was the main gap against 2025–2026 SaaS norms, more than any single missing interaction state. Kept the existing hue family and Space Grotesk/DM Mono pairing because they are still a distinctive, appropriate choice, not a flaw. | Product Owner request, 2026-08-22 session | 2026-08-22 |
| DES-015 | Accepted | Replace the brand mark: one custom SVG (a bold rounded "S" stroke with a single coral accent dot on ink) now defines both `public/icon.svg` (PWA icon/favicon) and the in-app `.brand-mark` in the nav/footer, at the same `--radius-xs` family as service icons. | The favicon (italic Georgia "s") and the in-app mark (a live font glyph, previously Playfair, then Fraunces) were two different marks that happened to share a letter; neither was a designed logo. One vector mark used everywhere is legible from a 16px favicon up through the full app icon and reads as an intentional identity rather than a placeholder initial. | Product Owner request, 2026-08-22 session | 2026-08-22 |
| DES-016 | Accepted | Revise DES-014: keep Playfair Display as the display/editorial typeface; do not adopt Fraunces. The DES-014 color-token refinement and radius/elevation system stand unchanged. | Direct Product Owner request after reviewing the Fraunces version. | Product Owner request, 2026-08-22 session | 2026-08-22 |

Append new decisions; do not rewrite accepted rationale. To replace a decision, mark it Superseded and link the new decision. Product scope changes return to the Product Owner, and technical implementation decisions return to the Tech Lead.
