<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/brand/obiter-main-lockup-clear-dark.png">
    <img src="./docs/brand/obiter-main-lockup-clear.png" alt="Obiter" width="640">
  </picture>
</p>

<p align="center">
  Legal intelligence infrastructure for source-grounded research, verification, redaction, legal source handling, and matter workspaces.
</p>

---

Obiter is a product platform for legal work where evidence, confidentiality, and reviewability matter. It is not a chatbot wrapper; it is a legal infrastructure layer for working with public sources, private matter material, verification evidence, and responsible AI-assisted workflows.

This repository is the product monorepo for the Obiter web app, desktop app, API, shared packages, legal-source search, and the foundations for private matter and verification workflows.

## Product

Obiter is being built around a small set of durable legal workflows:

- **Search**: source-grounded search across stored legal-source records, with Find Case Law discovery and hydration for UK judgments.
- **Matters**: private workspaces for legal documents, matter context, review state, deadlines, and generated artifacts.
- **Redaction**: reviewable and auditable protection of sensitive material before documents enter AI-assisted workflows.
- **Verification**: citation, quotation, and proposition checking against source evidence.
- **Research**: source-bound legal analysis with visible support and uncertainty.
- **Evaluation**: repeatable measurement of legal AI behavior, retrieval quality, and verification performance.

The current product slice is concentrated on Search, stored case pages, the authenticated workspace shell, matter scaffolding, and the API/storage boundaries that later private workflows will rely on.

## Principles

- Legal work should remain inspectable and attributable.
- Private matter data is sensitive by default.
- Search, verification, redaction, and research should be built on explicit source boundaries.
- Generated artifacts, document versions, audit records, prompts, embeddings, and logs must not blur public-source and private-matter data.
- Legal-critical failures should be visible rather than hidden behind quiet fallbacks.

## System

- `apps/web`: browser app.
- `apps/desktop`: Electron desktop app.
- `services/api`: Hono API for auth, matters, documents, Search, changelog, and future services.
- `services/legal-ingestor`: legal-source ingestion service.
- `packages/app-shell`: shared app shell, sidebar, route views, Search UI, and case views.
- `packages/contracts`: shared API and product contracts.
- `packages/database`: database package and migrations.
- `packages/legal-schema`: legal-source schemas.
- `packages/search-client`: Meilisearch helpers for Search.
- `packages/ui`: shared UI primitives and design tokens.
- `docs`: product, architecture, compliance, roadmap, and implementation notes.
- `infra`: deployment and operations placeholders.
- `data`: seed, fixtures, and evaluation placeholders.

## Current Search Surface

Search is the most developed product slice:

- `GET /api/search` searches Obiter-owned legal-source records.
- `POST /api/search/fetch` handles Find Case Law fetch-on-cache-miss.
- `GET /api/search/documents/:documentId` retrieves stored judgments.
- `/search` provides the shared Search UI.
- `/cases/:caseId` opens stored judgment pages.

PostgreSQL is the source-of-record direction for fetched legal-source metadata and hydrated document payloads. Meilisearch is a derived index for fast lexical retrieval. Find Case Law calls are queued as background hydration after Obiter-owned storage misses so the visible search path is not blocked on the external provider.

## Working In The Repo

Engineering workflow, commands, review expectations, and test guidance live in:

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

Package scopes still use `@obiter/*` while the product rename is in progress.

## License

Obiter is licensed under the [Elastic License 2.0](LICENSE).

You can inspect the source, fork it, run it yourself, adapt it for your own organisation, and contribute improvements back.

You cannot provide Obiter itself to third parties as a hosted or managed service, or sell managed Obiter hosting, without a separate commercial agreement.

Public legal source data is governed by the relevant upstream terms. The current UK case law path uses Find Case Law data from The National Archives, including the Open Justice Licence constraints and any separate computational-analysis licensing requirements.
