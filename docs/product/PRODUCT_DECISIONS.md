# Product Decision Log

> **Owner:** Product Owner
> **Status:** Approved decisions
> **Last reviewed:** 2026-08-20

| ID | Status | Owner | Decision | Rationale | Canonical source | Supersession |
| --- | --- | --- | --- | --- | --- | --- |
| PD-001 | Accepted | Product Owner | Position Subtle AI as “Your AI subscription optimizer.” | Focus on an outcome, not a tracker category. | [PRODUCT.md](PRODUCT.md) | None |
| PD-002 | Accepted | Product Owner | Optimize for reducing recurring expenses. | Gives prioritization a concrete user benefit. | [PRODUCT.md](PRODUCT.md) | None |
| PD-003 | Accepted | Product Owner | Answer “What should I do about my subscriptions?” | Keeps the experience action-oriented. | [PRODUCT.md](PRODUCT.md) | None |
| PD-004 | Accepted | Product Owner | Use Discover → Understand → Optimize → Act. | Provides the canonical product loop. | [PRODUCT.md](PRODUCT.md) | None |
| PD-005 | Accepted | Product Owner | Do not make chat or generic AI insights the primary interaction. | Useful intelligence should be automatic and contextual. | [PRODUCT.md](PRODUCT.md) | None |
| PD-006 | Accepted | Product Owner | Treat inspectable evidence as the basis of trust and explicitly separate facts, inferences, and recommendations. | Financial guidance must be explainable and must not present analysis as source fact. | [FEATURE-001](features/FEATURE-001.md) | None |
| PD-007 | Accepted | Product Owner | Resolve subscriptions and recommendations through stable IDs; recommendations retain their own ID, evidence IDs, and related subscription IDs. | Prevents page-context leakage and keeps every claim traceable. | [FEATURE-001](features/FEATURE-001.md) | None |
| PD-008 | Accepted | Product Owner | Keep Overview, Subscriptions, and Savings navigation. | Preserves a simple, task-focused information architecture. | [FEATURE-001](features/FEATURE-001.md) | None |
| PD-009 | Accepted | Product Owner | Prove evidence-backed discovery before adding AI recommendations. | Deterministic evidence handling is the first meaningful risk to validate. | [ROADMAP.md](ROADMAP.md) | None |
| PD-010 | Accepted | Product Owner | Require explicit, plain-language Gmail disclosure and user consent before authorization. | Protects user control and prevents premature connection claims. | [FEATURE-001](features/FEATURE-001.md) | None |
| PD-011 | Accepted | Product Owner | Preserve seeded and manual prototype behavior while FEATURE-001 is validated. | The vertical slice must not regress the existing experience. | [FEATURE-001](features/FEATURE-001.md) | None |

New decisions append to this log; do not rewrite history. A superseded decision retains its rationale, changes status to Superseded, and links to the replacing decision. Product decisions use Proposed, Accepted, Superseded, or Rejected status.
