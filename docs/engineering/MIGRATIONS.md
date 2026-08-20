# Database Migration and Recovery Rules

> **Owner:** Tech Lead  
> **Status:** Approved policy; runtime tooling not implemented  
> **Last reviewed:** 2026-08-20

`migrations/001_feature_001.sql` is a planned PostgreSQL schema. The current app does not connect to or execute migrations against PostgreSQL.

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

## Activation gate

No migration may be applied to shared or production data until the PostgreSQL runtime, migration runner, environment ownership, backup/restore process, security controls, and independent QA plan are approved.
