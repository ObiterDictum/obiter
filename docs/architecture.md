# Architecture

## System Shape

Obiter should be modular from the beginning.

```text
vault.legal web app
        |
Obiter desktop app
        |
Matter workspace
        |
-----------------------------------------------
|            |            |            |       |
Atlas      Redact       Verify       Vault   Docs
|            |            |                    |
Legal      Privacy      Trust               Product
Corpus     Layer        Layer               Surfaces
-----------------------------------------------
        |
Research
        |
Bench
        |
API
```

## Monorepo Layout

```text
obiter/
  apps/
    web/
    desktop/
    docs/
    marketing/
  services/
    api/
    worker/
    legal-ingestor/
  packages/
    app-shell/
    contracts/
    ui/
    database/
    legal-schema/
    citation-parser/
    redaction-policy/
    verification-core/
    search-client/
    config/
  infra/
    docker/
    monitoring/
    nginx/
    terraform/
  data/
    seed/
    evals/
    fixtures/
```

## Recommended Stack

### Frontend

- React
- TanStack Start for the web application shell and routing
- Electron for the desktop app
- TypeScript
- Tailwind
- shadcn/ui or equivalent
- TanStack Router
- TanStack Query
- TanStack Table where structured evidence grids are needed
- TanStack Virtual for long result sets and paragraph viewers
- Zustand for local UI state
- Zod

Electron is the default recommendation because it is the fastest path to a cross-platform desktop product with strong Node.js integration, broad device support, and shared React code across desktop and web. The tradeoff is runtime weight, so the application should be designed to keep heavy processing in workers and background services rather than the renderer.

### Backend

- Hono or Fastify
- Node.js and TypeScript across the API, orchestration layer, and desktop backend
- PostgreSQL 16
- pgvector
- Redis
- BullMQ
- Meilisearch
- Hetzner Object Storage
- Python worker for Privacy Filter and PDF-safe redaction
- optional native sidecar later only if a measurable performance bottleneck justifies it

### Retrieval

Search should start as hybrid retrieval:

- Meilisearch for keyword and faceted search
- PostgreSQL for metadata and relational structure
- pgvector for semantic retrieval
- API-level ranking and orchestration

Legal research depends on exact citation search, structured filtering, and paragraph-level precision. Semantic retrieval is useful, but it should stay subordinate to exact authority resolution and explicit evidence ranking.

## Delivery Priorities

The architecture should optimise for speed of delivery first, then targeted performance work where profiling justifies it.

- share TypeScript models across web, desktop, and API
- keep desktop and web UIs on the same React component base where possible
- keep long-running redaction, ingestion, and verification work out of the Electron renderer
- use BullMQ jobs for background work instead of synchronous request chains
- profile hot paths before introducing native complexity

The initial shared shell foundation for Phase 0.1 should live in:

- `packages/contracts` for shared product and route-facing types
- `packages/ui` for shared UI primitives and design tokens
- `packages/app-shell` for shared layout, query-backed shell state, and reusable route views

## Desktop And Sync Rules

- desktop is the primary serious workspace
- web mirrors the same product model and shared React code
- desktop supports encrypted local cache and offline work for non-search flows
- sync uses immutable document versions
- conflict resolution creates new versions rather than silent overwrite

## Security And Hosting Rules

- deploy core services on Hetzner infrastructure
- keep all hosted data in the EU
- use `better-auth` for identity
- enable audit logging from Phase 0
- preserve future on-prem compatibility without optimizing MVP around it

## Deployment Direction

- Cloudflare Pages for public web surfaces such as `obiter.tech` and documentation
- Hetzner VPS for API, workers, routing, PostgreSQL, Redis, and search in the early stage
- Hetzner Object Storage for uploads, source files, artifacts, and benchmark outputs
- future GPU or ML worker for redaction, embeddings, reranking, and model evaluation

## Decision Log

### Effect TS — contained pilot, not a platform commitment (July 2026)

Considered adopting Effect TS as the backend foundation during the app-shell rebuild ("we're restarting anyway"). Findings: the restart is confined to the presentation layer (~7.7k lines of UI/CSS replaced) while the ~9.2k-line backend being kept is disciplined and working — the layer where Effect would pay off is precisely the layer not being restarted. Maintainability was judged relative to the actual maintainers (a solo founder plus coding agents), for whom plain TypeScript with strong contracts and tests is the most fluently read and reviewed dialect, and where non-idiomatic Effect is the hardest failure mode to catch in review.

Decision: settle the question empirically, via a contained pilot in the Redact detection module behind a promise facade. Containment rules, exit criteria and the decision gate are recorded in the Effect TS Pilot section of `docs/prds/archive/redact-1-detection.md`.

Outcome (verified 2026-07-27): **the pilot never ran.** `services/api/src/redaction-detection.ts` shipped as plain TypeScript and no module in the repository imports `effect`. The question is therefore closed by default rather than by evidence, and `effect` remains not permitted as a dependency anywhere (contracts stay Zod; UI packages stay TanStack Query). Any future evaluation needs its own explicit decision and containment plan; it does not inherit this one.

### Detection mode — structured field on the run, not a version-string parse (August 2026)

Findings: FR1.1–FR1.4 are already implemented at the contract, persistence, read, endpoint, and audit boundaries. `packages/contracts/src/index.ts:91-96` owns the shared `detectionModeSchema`; migration `packages/database/migrations/0011_redaction_detection_provenance_and_retry.sql:19-44` adds and constrains `redaction_runs.detection_mode`, conservatively normalising legacy provenance; `services/api/src/redaction-database.ts:205` validates it at the read boundary; and `services/api/src/redaction-audit-report.ts:31,74-85` carries it in JSON, Markdown, and HTML. `detector_version` remains provenance, not a mode interface.

Decision: Keep detection mode as the shared Zod enum `model+supplement | heuristics+supplement | unknown`, persisted as the additive, not-null `redaction_runs.detection_mode` column introduced by migration 0011. Runtime writes keep `detection_mode` aligned with `detector_version`, while callers use only the structured field; a later migration author must not re-derive the mapping by parsing the version string. `unknown` means the provenance is unavailable, not that model detection did or did not run. Because the migration's default, not-null, and check constraint make null or malformed persisted values unreachable through supported paths, the read mapper uses `detectionModeSchema.parse` and fails loudly on integrity corruption rather than coalescing it to `unknown`. Audit artefacts remain self-describing with both `detectorVersion` and `detectionMode`, including a human-readable "Detection mode:" line in Markdown/HTML.

Outcome: No production architecture or runtime change is required for FR1. The existing contracts, migration, mapper, runtime writes, endpoints, and audit renderers remain the pattern; this record closes the seam without adding a fallback, duplicate schema, migration, or new abstraction.
