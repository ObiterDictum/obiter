# Current Product Scope

## Purpose

This document records the product surface that should be visible in the app shell right now. Search is the canonical product and domain label for public legal-source discovery, retrieval, and stored case pages. Legacy `atlas` package, service, index, and route names are temporary implementation identifiers until a separate cleanup renames them safely.

## Implemented Navigation

These sidebar entries should be active links:

- Home: the authenticated, role-aware information hub. This currently lives at `/workspace`.
- Matters: the matter list and matter detail shell.
- Search: the legal source search surface. It searches Ormont-owned stored legal sources first and queues Find Case Law hydration in the background on misses.

Search owns:

- `/search`
- `/cases/:caseId`
- `GET /api/search`
- `POST /api/search/fetch`
- `GET /api/search/documents/:documentId`

## Visible But Not Implemented

These entries can appear in the sidebar to show product direction, but they must be visually marked as planned and must not look like active tools:

- Drafting
- Research
- Documents
- Redaction
- Verification
- Review Queue
- Deadlines
- Uploads
- Evaluation
- Developer API

## Search Direction

Search should become the general legal source surface, not a case-law-only feature. The intended scope includes:

- case law
- legislation
- source timelines
- citation and amendment relationships
- connections between cases, statutes, provisions, and issues

The current implementation is the first slice of that surface: case law search and stored judgment pages.

## Naming Rules

- Use "Home" in navigation for the top-level information hub. The implementation may keep `/workspace` until route cleanup is handled separately.
- Do not use "Atlas" as the product or architecture label for the Search surface.
- Use "Search" for the implemented legal source search surface.
- Use "Redaction" and "Verification" in navigation, not internal shorthand.
- Use "Evaluation" for Bench unless an engineering-only admin screen is being built.
- Keep legacy internal package, service, index, and route names stable only as temporary implementation identifiers unless there is a separate refactor for code ownership.

## Implementation Boundary

The current case law implementation keeps a PostgreSQL source record for fetched judgments, including provider metadata, content hash, source/XML/PDF URIs, raw Atom entry metadata, and hydrated document payloads when available. Meilisearch is a derived index for fast lexical retrieval, not the source of record. Find Case Law calls are queued as background hydration after Ormont-owned storage misses so the user-visible search path is not blocked on the external provider.
