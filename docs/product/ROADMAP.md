# Roadmap

> **Owner:** Product Owner
> **Status:** Approved current ordering
> **Last reviewed:** 2026-08-20

## Now — P0

### FEATURE-001: Evidence-Backed Gmail Receipt Ingestion

**Status:** Implementing
**Specification:** [FEATURE-001.md](features/FEATURE-001.md)

Complete and independently validate the mock vertical slice, then resolve the production gates before any real-provider rollout. The meaningful test is receipt discovery through evidence review, not connection alone.

## Decisions required before the next feature is approved

1. Data retention, deletion, export, and disconnect behavior.
2. Initial merchant, format, region, language, and currency coverage.
3. Confidence thresholds and ambiguous-detection review behavior.
4. Rollout success metrics and test cohort.
5. Which next outcome best advances Discover → Understand → Optimize → Act.

## Candidate work — not approved or prioritized

- Persist user corrections.
- Broaden deterministic receipt and recommendation coverage.
- Add AI only where validated semantic extraction or explanation adds value.
- Background synchronization and notifications.
- Bank integrations and subscription actions.

Candidates do not authorize implementation. The Product Owner must define value, scope, priority, and acceptance criteria; material product changes require Founder approval.
