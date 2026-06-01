# Architecture

## System Shape

Ormont should be modular from the beginning.

```text
vault.legal web app
        |
Ormont desktop app
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
ormont/
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

- Cloudflare Pages for public web surfaces such as `ormont.tech` and documentation
- Hetzner VPS for API, workers, routing, PostgreSQL, Redis, and search in the early stage
- Hetzner Object Storage for uploads, source files, artifacts, and benchmark outputs
- future GPU or ML worker for redaction, embeddings, reranking, and model evaluation
