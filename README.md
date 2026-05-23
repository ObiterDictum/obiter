# Ormont

Ormont is a legal work platform for searching sources, managing matters, verifying legal claims, redacting sensitive material, and building trustworthy AI-assisted workflows.

The product is for legal work where evidence, confidentiality, and auditability matter. It should help users find the law, understand what supports a claim, protect private matter data, and avoid confident unsupported output.

## What Works Today

The current app shell exposes three real surfaces:

- **Home**: the signed-in workspace hub.
- **Matters**: matter list and matter detail shell.
- **Search**: public UK case law search backed by the Ormont API, Meilisearch, and Find Case Law fetch-on-cache-miss.

Search currently supports:

- cached legal-source search through `GET /api/search`
- fetch-on-cache-miss through `POST /api/search/fetch`
- stored case retrieval through `GET /api/search/documents/:documentId`
- `/search` for legal-source search
- `/cases/:caseId` for stored judgment pages

Search stores indexed judgment records in Meilisearch for the current workflow. That is enough for search and case viewing, but it is not the final durable source-of-record design. Canonical persistence in PostgreSQL and object storage remains follow-up work.

## Where This Is Going

Ormont is not a chatbot wrapper. The platform is built around source-grounded legal work:

- Search should cover case law, legislation, source timelines, citation relationships, amendment history, and links between cases, statutes, provisions, and issues.
- Matters should become the private workspace for documents, versions, review state, deadlines, and generated artifacts.
- Redaction should support reviewable, auditable protection of sensitive material.
- Verification should check citations, quotations, and propositions against source evidence.
- Research should produce source-bound analysis with visible support and uncertainty.
- Evaluation should make legal AI behavior measurable instead of relying on vague accuracy claims.
- The API should expose stable legal infrastructure for first-party and future developer workflows.

Private matter data must never become training data or background product learning by accident. Hosted processing, model calls, prompts, embeddings, logs, and audit records all need explicit boundaries.

## License

Ormont is licensed under the [Elastic License 2.0](LICENSE).

You can inspect the source, fork it, run it yourself, adapt it for your own organisation, and contribute improvements back.

You cannot provide Ormont itself to third parties as a hosted or managed service, or sell managed Ormont hosting, without a separate commercial agreement.

Public legal source data is governed by the relevant upstream terms. The current UK case law path uses Find Case Law data from The National Archives, including the Open Justice Licence constraints and any separate computational-analysis licensing requirements.

## Repository Map

This is the Ormont product monorepo.

- `apps/web`: browser app.
- `apps/desktop`: desktop app.
- `services/api`: hosted API for auth, matters, documents, Search, changelog, and future services.
- `services/atlas-ingestor`: legacy-named Search ingestion service.
- `packages/app-shell`: shared app shell and route views for web and desktop.
- `packages/contracts`: shared API and product contracts.
- `packages/legal-schema`: legal-source schemas.
- `packages/search-client`: Meilisearch helpers for Search.
- `packages/ui`: shared UI primitives and design tokens.
- `docs`: product, architecture, compliance, roadmap, and implementation notes.

User-facing product language should use **Search**, not the old internal module name. Any remaining legacy identifiers are implementation debt unless a rename is explicitly in scope.

## Local Development

Install dependencies:

```bash
pnpm install
```

Run the app and services:

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

- Server-side access control is required. UI hiding is not authorization.
- Private matter data is sensitive by default.
- Document versions, audit records, and generated artifacts must not be silently overwritten.
- Logs, telemetry, object keys, fixtures, prompts, embeddings, and snapshots must not contain raw private matter data or secrets.
- Legal-critical failures should be explicit. Do not hide uncertainty behind quiet fallbacks.
- Shared contracts and schemas belong in packages, not copied across apps and services.

## Current Priority

Make Search reliable enough to trust: correct metadata, consistent filters, source-grounded case pages, and a clean product vocabulary. Then build the private matter workflows and verification layer on top of that foundation.
