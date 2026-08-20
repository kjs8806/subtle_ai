# Project Glossary

> **Owner:** Project Coordinator  
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
| Coordinator | Workflow and traceability owner; not a product, design, or architecture authority. |
| Tech Lead sub-agent | Dedicated architecture, plan, implementation-instruction, and technical-review role invoked by the Coordinator. |
| Codex | Implementer of an approved plan; cannot silently redefine scope or architecture. |
| QA | Independent validation role for criteria, regressions, evidence, and release quality. |
