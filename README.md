# Ormont

Ormont is an open legal intelligence platform for research, redaction, verification, benchmarking, and AI-safe legal work.

The platform is being built to make law searchable, understandable, verifiable, privacy-preserving, benchmarked, and open enough to support justice.

## What We Are Building

Ormont is designed as a legal platform rather than a single feature product. The core modules are:

- Atlas: open legal data engine and search layer
- Redact: legal redaction and pseudonymisation
- Verify: citation, quote, and proposition verification
- Research: AI-assisted legal research with source-bound answers
- Vault: secure matter workspace for private documents
- Bench: legal AI evaluation and benchmarking
- API: developer-facing legal infrastructure

Phase 0 builds the application foundation. Phase 1 focuses on `Atlas + Redact + Verify + a thin Research interface`.

## Documentation

The source planning document remains [guide.md](C:\Users\karl-\Documents\source\Ormont\guide.md). The working product docs are split into focused documents under [docs](C:\Users\karl-\Documents\source\Ormont\docs):

- [Product Thesis](C:\Users\karl-\Documents\source\Ormont\docs\product-thesis.md)
- [Rules](C:\Users\karl-\Documents\source\Ormont\RULES.md)
- [PR Rules](C:\Users\karl-\Documents\source\Ormont\PR.md)
- [Testing Rules](C:\Users\karl-\Documents\source\Ormont\TESTING.md)
- [Phase 0 Foundation](C:\Users\karl-\Documents\source\Ormont\docs\phase-0.md)
- [Platform Modules](C:\Users\karl-\Documents\source\Ormont\docs\platform-modules.md)
- [Phase 1 Scope](C:\Users\karl-\Documents\source\Ormont\docs\phase-1.md)
- [Phase 1 Priorities](C:\Users\karl-\Documents\source\Ormont\docs\phase-1-priorities.md)
- [Architecture](C:\Users\karl-\Documents\source\Ormont\docs\architecture.md)
- [Data and Compliance](C:\Users\karl-\Documents\source\Ormont\docs\data-and-compliance.md)
- [Roadmap](C:\Users\karl-\Documents\source\Ormont\docs\roadmap.md)
- [Phase 1 Atlas](C:\Users\karl-\Documents\source\Ormont\docs\phase-1-atlas.md)
- [Phase 1 Redact](C:\Users\karl-\Documents\source\Ormont\docs\phase-1-redact.md)
- [Phase 1 Verify](C:\Users\karl-\Documents\source\Ormont\docs\phase-1-verify.md)
- [Phase 1 Research](C:\Users\karl-\Documents\source\Ormont\docs\phase-1-research.md)
- [Specs](C:\Users\karl-\Documents\source\Ormont\docs\specs\README.md)

## Repository Shape

This repository is a monorepo for the Ormont platform:

- `apps/`: web, desktop, docs, and marketing surfaces
- `services/`: API, ingestion, workers, verification, and benchmarking jobs
- `packages/`: shared UI, schema, parsing, config, and verification logic
- `infra/`: deployment, networking, and monitoring
- `data/`: seed data, fixtures, and evaluation assets
