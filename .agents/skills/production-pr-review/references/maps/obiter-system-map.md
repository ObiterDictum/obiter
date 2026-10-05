# Obiter System Map

This is the skill-local source map for Obiter PR reviews. Treat it as the review operating map and validate current project facts against code and the review knowledge repo before relying on them.

Human visual companion: `obiter-system-map.html`.

## Layer Map

```text
apps/web
  -> packages/app-shell
  -> packages/contracts
  -> services/api

apps/desktop
  -> Electron renderer
  -> preload/main boundary
  -> packages/app-shell
  -> packages/contracts
  -> services/api or local desktop services

services/api
  -> packages/contracts
  -> database
  -> object storage
  -> search/vector indexes
  -> queues/workers
  -> external providers/model services

review repo
  -> durable architecture notes
  -> review playbooks
  -> recurring findings patterns
```

## Boundary Invariants

- `packages/contracts` is the shared language for route-facing types, schemas, enums, and state machines.
- `packages/ui` remains presentation-focused and does not know about auth, storage, network calls, legal verification, or matter data policy.
- `packages/app-shell` owns shared shell and reusable product views used by web and desktop where behavior is shared.
- `apps/web` and `apps/desktop` should be thin platform surfaces.
- Desktop renderer code must not directly access Node, filesystem, secrets, or privileged APIs.
- Hosted API routes must validate untrusted input and enforce permissions server-side.
- Search indexes and generated artifacts are derived state unless a product decision says otherwise.
- Private matter flows must preserve organisation and matter scope through reads, writes, caches, indexes, object keys, artifacts, and audit views.

## Map Update Rule

When a review validates a concrete internal flow, record durable details in `C:/Users/karl-/Documents/source/Obiter/review/obiter/architecture/` or the relevant findings-pattern file. Keep examples synthetic and do not store secrets, private matter data, raw legal text, prompts, embeddings, sensitive logs, screenshots, customer data, or object keys containing sensitive names.
