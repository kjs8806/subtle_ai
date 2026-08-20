# Product

> **Owner:** Product Owner  
> **Status:** Approved baseline  
> **Last reviewed:** 2026-08-20

## Positioning

Subtle AI is **your AI subscription optimizer**. Its outcome is to help people reduce recurring expenses. The product must answer **“What should I do about my subscriptions?”**, not merely list what subscriptions exist.

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

The repository contains a responsive Vite JavaScript PWA with seeded and manual prototype data, an evidence-backed deterministic receipt pipeline, subscription detail, savings views, and a mock FEATURE-001 Gmail discovery flow. The mock Fastify API, fake Gmail provider, and in-memory repository are development infrastructure, not production integrations.

Navigation remains **Overview**, **Subscriptions**, and **Savings**.

## Active milestone

[FEATURE-001 — Evidence-Backed Gmail Receipt Ingestion](features/FEATURE-001.md) is the only approved P0 milestone and is **Implementing**. It proves:

> Connect Gmail → discover a receipt → create an evidence-backed subscription → inspect matching evidence.

Production Gmail, PostgreSQL deployment, public data-lifecycle behavior, background synchronization, bank integrations, notifications, and AI-provider integration remain gated by approved decisions and validation.

## Source of truth

Approved feature scope and acceptance criteria live in feature issues and specifications. Priorities live in [ROADMAP.md](ROADMAP.md). Product rationale lives in [PRODUCT_DECISIONS.md](PRODUCT_DECISIONS.md).
