# Database Migration and Recovery Rules

> **Owner:** Tech Lead
> **Status:** Approved policy; runtime tooling implemented for the supervised Codespaces environment
> **Last reviewed:** 2026-08-21

`migrations/001_feature_001.sql` through `005_feature_001_token_contract.sql` define the current PostgreSQL schema. `server/persistence/migrations.js` executes unapplied ordered migrations transactionally, guarded by a PostgreSQL advisory lock so concurrent or repeated startups against the same database apply safely. When `PERSISTENCE_PROVIDER=postgres`, `server/bootstrap.js` runs these migrations automatically at server startup, before the server accepts requests; a migration failure aborts startup rather than starting with a partially migrated schema. Activation against shared or production data remains gated — see [Activation gate](#activation-gate).

Migration `004` removes the provisional service/merchant uniqueness index. Migration `005` changes encrypted token storage to text ciphertext plus explicit key-version metadata.

## Rules

1. Use ordered, uniquely named migration files. Applied migrations are immutable; corrections use a new migration.
2. Prefer transactional DDL where PostgreSQL supports it.
3. Use expand-and-contract for destructive or compatibility-sensitive changes.
4. Keep account ownership, evidence traceability, and stable IDs intact.
5. Do not log or seed real receipt content, credentials, provider tokens, or personal data.
6. Include forward execution, failure behavior, recovery steps, compatibility impact, and expected duration in the technical plan and PR.
7. Prefer a tested forward fix over a destructive down migration. When rollback is unsafe, explicitly document restore or recovery steps.
8. Require a verified backup/restore path before production schema changes.
9. Test migrations against a disposable PostgreSQL environment before activation, including empty, representative, rerun/idempotency where applicable, and failure cases.
10. QA records exact migration version, database version, environment, results, defects, and recovery evidence.
11. Backfills are bounded, resumable, idempotent where feasible, observable, and safe to stop/restart; record progress and failure handling without sensitive data.
12. Assess lock duration, table size, runtime, resource use, and application availability. Use timeouts, batching, or an online approach when needed.
13. Separate destructive column/table removal from the compatibility release that stops using it; removal occurs only after verification and an approved recovery checkpoint.
14. State the minimum/maximum compatible application versions and verify backup freshness and restore usability before execution.

## Activation gate

No migration may be applied to shared or production data until the PostgreSQL runtime, migration runner, environment ownership, backup/restore process, security controls, and independent QA plan are approved.
