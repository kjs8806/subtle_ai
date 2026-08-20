# Design Decision Log

> **Owner:** Senior Product Designer
> **Status:** Append-only accepted decisions
> **Canonical FEATURE-001 design:** [FEATURE-001](../product/features/FEATURE-001.md)
> **Last reviewed:** 2026-08-20

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
| DES-010 | Accepted | Retain responsive installable PWA delivery and the editorial/calm visual language. | Extends the current experience without an unapproved redesign. | [Design system](DESIGN_SYSTEM.md) | 2026-08-20 |
| DES-011 | Accepted | Use `APP_CONFIG.name` for visible branding. | Keeps the brand easy to change. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |
| DES-012 | Accepted | Never fabricate progress, counts, timestamps, confidence, or success. | Feedback must remain trustworthy. | [FEATURE-001](../product/features/FEATURE-001.md) | 2026-08-20 |

Append new decisions; do not rewrite accepted rationale. To replace a decision, mark it Superseded and link the new decision. Product scope changes return to the Product Owner, and technical implementation decisions return to the Tech Lead.
