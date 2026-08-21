# Project Glossary

> **Owner:** Project Manager
> **Status:** Maintained reference
> **Last reviewed:** 2026-08-20

| Term | Meaning |
| --- | --- |
| Subtle AI | Configurable current brand for the subscription optimizer. |
| Subscription | An ID-backed recurring-expense record. |
| Evidence | Source material that supports one or more recorded facts. |
| Confirmed from receipt | A fact directly supported by receipt evidence. |
| Inferred from receipt | An analyzed value not directly confirmed by receipt text. |
| Recommendation | Advice derived from identified evidence or inferences. |
| Confidence | Metadata describing certainty; it does not replace provenance. |
| Stable subscription ID | Canonical key used to resolve list, detail, evidence, history, and recommendations. |
| Receipt pipeline | Deterministic parsing, normalization, evidence, subscription, billing, price, and recommendation logic in `src/services/receiptPipeline.js`. |
| FEATURE-001 | Evidence-backed Gmail receipt-ingestion vertical slice. |
| Fake provider | Deterministic local Gmail substitute; it makes no Google API calls. |
| Production gate | A decision, implementation, validation, or approval required before public production use. |
| Definition of Ready | Evidence required before implementation handoff. |
| Definition of Done | Evidence required before a feature can be considered complete. |
| ADR | Architecture Decision Record stored in `docs/engineering/adr/`. |
| Project Manager | Workflow and traceability owner; not a product, design, or architecture authority. |
| Tech Lead sub-agent | Dedicated architecture, plan, implementation-instruction, and technical-review role invoked by the Project Manager. |
| Codex | Implementer of an approved plan; cannot silently redefine scope or architecture. |
| QA | Independent validation role for criteria, regressions, evidence, and release quality. |
| Vite PWA | The current JavaScript web frontend and installable Progressive Web App built with Vite. |
| Fastify API boundary | Local server-side `/api/v1` interface used by the mock FEATURE-001 flow. |
| In-memory repository | Non-production persistence that resets when the local server restarts. |
| Provenance | Metadata distinguishing whether a field is confirmed, inferred, or a recommendation and linking its evidence. |
| Idempotency | Repeating the same operation produces no duplicate subscription or billing event. |
| Source connection | Account-scoped state describing authorization and availability of an external data source. |
| Scan run | One explicit attempt to inspect source messages and record its outcome. |
| Same-origin API | Browser/API deployment model where frontend requests use the application's origin and `/api/v1` path. |
| Mock vertical slice | End-to-end-shaped validation using deterministic local substitutes, not production services. |
| Technical Ready | Lifecycle stage where the approved technical plan and all Ready gates permit implementation. |
| `CI / validate` | GitHub Actions required check that installs, tests, builds, and checks whitespace. |
