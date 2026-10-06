# PR Coverage Map Template

Complete this map before detailed judgment, scoring, or final verdict.

```markdown
## System / Coverage Map

- System map entries loaded:
  - `[path]` - validated / stale / missing / newly updated
- Internal flows traced:
  - Entrypoint:
  - Contracts:
  - Auth and scope:
  - Source of truth:
  - Derived state:
  - Audit/logging:
  - External boundaries:
  - Failure/retry behavior:
- Changed packages/apps/services:
- Public API or contract changes:
- Data model, migration, or schema changes:
- Data classes touched:
  - public legal corpus / private matter data / auth-session data / audit metadata / generated artifacts / telemetry-logs / model-AI data
- Trust boundaries touched:
  - browser / Electron renderer / preload-main / API / worker / database / object storage / search-vector index / queue / external provider / CI
- Isolation boundaries touched:
  - organisation / matter / user / cache key / object key / search index / artifact path / audit view
- Direct dependents inspected:
  - exports/types/schemas:
  - routes/API/IPC:
  - database/storage/search/queue/audit:
  - tests/docs:
- Verification mapped to risk:
  - command/manual check:
  - risk proven:
  - result:
- Stale or missing map areas:
- Residual uncertainty:
```

If residual uncertainty affects sensitive code, the verdict cannot be `Approve`.
