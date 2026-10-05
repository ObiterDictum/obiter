# System Map Workflow

Use System Maps to make Obiter internals known and reviewable instead of guessed during each PR.

## Sources

- Skill-local map operating model: `references/system-map.md`.
- Skill-local agent-readable maps: `references/maps/*.md`.
- Skill-local human visual maps: `references/maps/*.html`.
- Current durable Obiter project knowledge: `C:/Users/karl-/Documents/source/Obiter/review/obiter/architecture/`.
- Recurring Obiter patterns: `C:/Users/karl-/Documents/source/Obiter/review/obiter/findings-patterns/`.

Markdown maps are the canonical agent-readable source. HTML maps are visual companions for humans and should not be the only source of a review fact.

## Required Review Steps

1. Load the relevant skill-local map files and review repo entries for the touched area.
2. Validate touched map entries against current code before relying on them.
3. Trace the changed flow from entrypoint to persistence, external provider, queue, search index, audit event, or UI state.
4. Search direct dependents of changed contracts, routes, schemas, storage keys, status values, permissions, audit events, and queue payloads.
5. Record newly learned durable internal behavior in the review repo using synthetic examples only.

## What A Map Captures

- package and service boundaries
- route/API/IPC entrypoints and downstream services
- data lifecycle from input to database, object storage, search, queue, audit, or UI
- organisation, matter, user, cache-key, object-key, index, artifact, and audit isolation boundaries
- source-of-truth versus derived state
- invariants that must hold across web, desktop, API, workers, storage, and tests
- code references or stable file paths supporting the map
- known uncertainty or stale areas that need validation

## Flow Entry Shape

```text
Flow: [short name]
Entrypoint: [route/API/IPC/UI/worker/CLI]
Contracts: [schemas/types/request and response shapes]
Auth and scope: [organisation/matter/user/session checks]
Source of truth: [database/object storage/provider/local file]
Derived state: [search index/cache/artifact/UI projection]
Audit/logging: [audit events and redaction expectations]
External boundaries: [providers/model calls/network/CI/dependency]
Failure and retry behavior: [idempotency/conflict/error rules]
Direct dependents: [packages/routes/tests/docs that consume it]
Validation evidence: [tests/checks/manual proof]
Known uncertainty: [stale/missing areas needing code validation]
```

## Approval Guardrail

For sensitive code, do not approve until the touched flow can be explained from entrypoint through source-of-truth and derived-state boundaries, with organisation/matter isolation and audit/logging implications checked. If existing maps are missing or stale, validate from code and record the durable parts.
