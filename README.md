# Ormont

Ormont is a desktop-first legal work platform for source-grounded research, matter work, redaction, verification, and audit-friendly AI assistance.

The product is being built for legal work where evidence, confidentiality, and reviewability matter. The current `dev` branch is not a finished product; it is the foundation of the web, desktop, API, and legal-source search stack that the private matter and verification workflows will build on.

## Current State

The repo currently contains:

- a shared React app shell used by the web and Electron apps
- web routes for sign-in, the workspace home, matters, Search, and stored case pages
- Electron renderer routes for Search and stored case pages
- a Hono API service with auth, current-user, matters, documents, changelog, and Search routes
- `better-auth` wiring for email/password and magic-link flows
- PostgreSQL migrations for auth, matters, and legal-source document storage
- legal-source schemas, Search contracts, and Meilisearch client helpers
- Find Case Law integration for UK judgment discovery and hydration
- focused tests for the API, app shell, legal schemas, database wiring, and Search helpers

The implemented product surfaces are:

- **Home**: the authenticated workspace hub, currently routed as `/workspace`.
- **Matters**: matter list and matter detail shell.
- **Search**: public UK case law search backed by the Ormont API, PostgreSQL legal-source records, Meilisearch, and Find Case Law hydration.
- **Case pages**: stored judgment pages at `/cases/:caseId`.

Several navigation entries are intentionally visible as planned product direction, not working tools yet: Drafting, Research, Documents, Redaction, Verification, Review Queue, Deadlines, Uploads, Evaluation, and Developer API.

## Search Today

Search is the most developed product slice. It currently supports:

- `GET /api/search` for searching Ormont-owned legal-source records
- `POST /api/search/fetch` for Find Case Law fetch-on-cache-miss
- `GET /api/search/documents/:documentId` for stored judgment retrieval
- `/search` for the shared Search UI
- `/cases/:caseId` for stored judgment viewing

PostgreSQL is the source-of-record direction for fetched legal-source metadata and hydrated document payloads. Meilisearch is a derived index for fast lexical retrieval. Find Case Law calls are queued as background hydration after Ormont-owned storage misses so the visible search path is not blocked on the external provider.

User-facing product language should use **Search**, not the older internal name **Atlas**. Remaining `atlas` references in docs or legacy package names are implementation debt unless a rename is explicitly in scope.

## Product Direction

Ormont is not intended to be a chatbot wrapper. The platform is moving toward source-bound legal workflows:

- Search should cover case law, legislation, source timelines, citation relationships, amendment history, and links between cases, statutes, provisions, and issues.
- Matters should become the private workspace for documents, immutable versions, review state, deadlines, and generated artifacts.
- Redaction should produce reviewable and auditable protection of sensitive material.
- Verification should check citations, quotations, and propositions against source evidence.
- Research should produce source-bound analysis with visible support and uncertainty.
- Evaluation should make legal AI behavior measurable instead of relying on vague accuracy claims.
- The API should expose stable legal infrastructure for first-party and future developer workflows.

Private matter data must never become training data or background product learning by accident. Hosted processing, model calls, prompts, embeddings, logs, and audit records all need explicit boundaries.

## Repository Map

This is the Ormont product monorepo.

- `apps/web`: browser app.
- `apps/desktop`: Electron desktop app.
- `apps/docs`: documentation app placeholder.
- `apps/marketing`: marketing app placeholder.
- `services/api`: Hono API for auth, matters, documents, Search, changelog, and future services.
- `services/legal-ingestor`: legal-source ingestion service.
- `services/worker`: background worker placeholder.
- `packages/app-shell`: shared app shell, sidebar, route views, and Search/case UI.
- `packages/contracts`: shared API and product contracts.
- `packages/database`: database package and migrations.
- `packages/legal-schema`: legal-source schemas.
- `packages/search-client`: Meilisearch helpers for Search.
- `packages/ui`: shared UI primitives and design tokens.
- `packages/redaction-policy`: redaction policy package placeholder.
- `packages/verification-core`: verification package placeholder.
- `packages/config`: shared configuration placeholder.
- `docs`: product, architecture, compliance, roadmap, and implementation notes.
- `infra`: deployment and operations placeholders.
- `data`: seed, fixtures, and evaluation placeholders.

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the main services:

```bash
pnpm dev:web
pnpm dev:desktop
pnpm dev:api
pnpm dev:desktop:api
```

Run broad verification:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Run targeted checks while iterating:

```bash
pnpm --filter @ormont/api test
pnpm --filter @ormont/app-shell typecheck
pnpm --filter @ormont/web build
```

## Engineering Standards

Read these before making product changes:

- [AGENTS.md](AGENTS.md)
- [RULES.md](RULES.md)
- [PR.md](PR.md)
- [TESTING.md](TESTING.md)

Useful product context:

- [Current Product Scope](docs/current-product-scope.md)
- [Product Thesis](docs/product-thesis.md)
- [Architecture](docs/architecture.md)
- [Data and Compliance](docs/data-and-compliance.md)
- [Roadmap](docs/roadmap.md)
- [Specs](docs/specs/README.md)

The short version:

- Desktop is the primary serious workspace.
- Web should mirror the same product model and shared code where possible.
- Server-side access control is required. UI hiding is not authorization.
- Private matter data is sensitive by default.
- Document versions, audit records, and generated artifacts must not be silently overwritten.
- Logs, telemetry, object keys, fixtures, prompts, embeddings, and snapshots must not contain raw private matter data or secrets.
- Legal-critical failures should be explicit. Do not hide uncertainty behind quiet fallbacks.
- Shared contracts and schemas belong in packages, not copied across apps and services.

## Current Priority

Make Search reliable enough to trust: correct metadata, consistent filters, source-grounded case pages, stable storage/index boundaries, and clean product vocabulary. Then build the private matter workflows and verification layer on top of that foundation.

## License

Ormont is licensed under the [Elastic License 2.0](LICENSE).

You can inspect the source, fork it, run it yourself, adapt it for your own organisation, and contribute improvements back.

You cannot provide Ormont itself to third parties as a hosted or managed service, or sell managed Ormont hosting, without a separate commercial agreement.

Public legal source data is governed by the relevant upstream terms. The current UK case law path uses Find Case Law data from The National Archives, including the Open Justice Licence constraints and any separate computational-analysis licensing requirements.
