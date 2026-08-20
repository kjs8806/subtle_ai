# UX Principles

> **Owner:** Senior Product Designer
> **Status:** Approved baseline
> **Last reviewed:** 2026-08-20

## Purpose and authority

These principles guide how approved product requirements are experienced. The Designer owns UX decisions; the Product Owner owns scope and value; the Tech Lead owns implementation architecture. The canonical feature design takes precedence for feature-specific behavior, followed by accepted design decisions, this principle set, and then current implementation. Conflicts return to the owning role rather than being silently resolved.

1. **Lead with the next useful action.** Prioritize what a user can review or do over passive insight volume.
2. **Keep intelligence quiet and automatic.** Surface recommendations contextually; do not force a chat-first experience.
3. **Earn trust with evidence.** Make the source and reasoning inspectable near the affected subscription.
4. **Use canonical provenance language.** Use **Confirmed from receipt**, **Inferred from receipt**, and **Recommendation**.
5. **Never fabricate feedback.** Do not invent progress, counts, timestamps, connected state, confidence, or success.
6. **Maintain ID-backed coherence.** List, detail, evidence, history, confidence, and recommendations must resolve through the selected subscription ID.
7. **Preserve user control.** Explain external access before authorization and support cancellation, retry, correction, and disconnect.
8. **Separate states.** Authorization, connection, scanning, results, and errors are different conditions.
9. **Make success meaningful.** Discovery succeeds when the user can review the resulting subscription and evidence, not when authorization merely completes.
10. **Disclose progressively.** Keep primary decisions simple and reveal supporting evidence and technical detail when relevant.
11. **Design responsively by priority.** Preserve actions, evidence, and state clarity before decorative layout.
12. **Build accessibly.** Support keyboard, assistive technology, visible focus, semantic structure, contrast, reduced motion, and 44px targets.
13. **Retain the current visual character.** Extend the established editorial, calm visual language instead of redesigning opportunistically.
14. **Centralize branding.** Visible app naming and document titles use `APP_CONFIG.name`.

## Changing the design

1. Link the affected feature/issue and approved product requirement.
2. Record flow, component/state, responsive, accessibility, and system impact.
3. Add or supersede a decision in [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) when the choice is durable.
4. Obtain Product Owner alignment if product behavior changes and Tech Lead input if implementation risk changes.
5. Review the exact candidate commit and record evidence in the PR.
