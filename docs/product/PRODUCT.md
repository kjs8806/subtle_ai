# Product

> **Owner:** Product Owner
> **Status:** Approved baseline
> **Last reviewed:** 2026-08-20

## Positioning

Subtle AI is **your AI subscription optimizer**. Its outcome is to help people reduce recurring expenses. The product must answer **“What should I do about my subscriptions?”**, not merely list what subscriptions exist.

## User problem

Recurring expenses are easy to start, difficult to remember, and hard to evaluate across renewal dates, price changes, overlapping services, and scattered receipt evidence. Users need a trustworthy way to discover recurring charges, understand what is known and why, prioritize worthwhile opportunities, and choose a next action without manually maintaining a perfect list.

## Core loop

**Discover → Understand → Optimize → Act**

- **Discover:** identify recurring expenses from user-approved sources.
- **Understand:** explain cost, cadence, evidence, confidence, and change.
- **Optimize:** rank trustworthy opportunities by likely value.
- **Act:** help the user take an intentional next step.

## Product principles

1. Be action-oriented and surface recommendations only when useful.
2. Let intelligence work automatically; chat is not the primary interface.
3. Attach every subscription, evidence item, and recommendation to stable IDs.
4. Clearly distinguish evidence-backed facts, analysis inferences, and recommendations.
5. Never manufacture missing values, progress, timestamps, confidence, or success.
6. Make evidence inspectable so users can understand and correct the system.
7. Require explicit consent before accessing an external source and preserve user control.
8. Keep the product name configurable through `APP_CONFIG.name`.

## Current product

The repository contains a responsive Vite JavaScript PWA with:

- Subscription spending overview with monthly and annual views.
- Ranked Savings Feed and action-oriented recommendations.
- Subscription list and ID-backed Subscription Detail.
- Per-subscription analysis, current/annual cost, renewal, price history, billing history, evidence, provenance, and confidence.
- “This looks wrong,” manage-subscription state, comparison data, and manual entry.
- Seeded deterministic data adapted through the receipt pipeline.
- Mock FEATURE-001 Gmail authorization, scanning, discovery, evidence, and recovery states through a local Fastify API, fake provider, and in-memory repository.
- Installable PWA behavior and responsive mobile layout.

Navigation remains **Overview**, **Subscriptions**, and **Savings**.

## Authorized boundaries

The approved work is the existing prototype plus the mock-backed FEATURE-001 vertical slice. It may preserve and validate deterministic parsing, stable IDs, provenance, evidence, confidence, idempotency, account-scoped mock behavior, and the current UI.

The following are not authorized by this baseline:

- Public or production Gmail integration.
- Continuous/background Gmail monitoring or jobs.
- Bank integrations or financial transactions.
- AI-provider integration or unsupported AI-generated claims.
- Notifications.
- Multiple Gmail accounts per user.
- Cancellation, purchase, negotiation, or switching transactions.
- Chat-first navigation or generic AI-insight feeds.

Each requires approved product scope, design, technical decisions, security/privacy controls, tests, and release gates.

## Active milestone

[FEATURE-001 — Evidence-Backed Gmail Receipt Ingestion](features/FEATURE-001.md) is the only approved P0 milestone and is **Implementing**. It proves:

> Connect Gmail → discover a receipt → create an evidence-backed subscription → inspect matching evidence.

Production Gmail, PostgreSQL deployment, public data-lifecycle behavior, background synchronization, bank integrations, notifications, and AI-provider integration remain gated by approved decisions and validation.

## Open product decisions

- Initial target customer segment and validation cohort.
- Business model and pricing.
- Launch merchant, format, region, language, and currency coverage.
- Retention, disconnect, deletion, and export lifecycle policy.
- Confidence thresholds and ambiguous-detection review policy.
- Outcome, trust, discovery, and optimization success metrics.
- The next approved feature after FEATURE-001.

## Source of truth

Approved feature scope and acceptance criteria live in feature issues and specifications. Priorities live in [ROADMAP.md](ROADMAP.md). Product rationale lives in [PRODUCT_DECISIONS.md](PRODUCT_DECISIONS.md).
