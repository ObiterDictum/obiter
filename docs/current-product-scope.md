# Current Product Scope

## Purpose

This document records the product surface that should be visible in the app shell right now. Search is the canonical product and domain label for public legal-source discovery, retrieval, and stored case pages. Legacy `atlas` package, service, index, and route names are temporary implementation identifiers until a separate cleanup renames them safely.

## Implementation Status (verified against the codebase, July 2026)

Status is tracked in three tiers. "Implemented" means a user action reaches the real API and real data end-to-end — not that a screen exists.

### Implemented end-to-end (API + UI)

- Search: the legal source search surface. It searches Obiter-owned stored legal sources first and queues Find Case Law hydration in the background on misses. This is currently the only UI surface wired to the real API.

Search owns:

- `/search`
- `/cases/:caseId`
- `GET /api/search`
- `POST /api/search/fetch`
- `GET /api/search/documents/:documentId`

### API implemented, UI is demo fixture

The backend for these exists (org-scoped, audited, migration-backed) but the UI renders hardcoded Phase 0 demo data (`createPhaseZeroShellSnapshot` in `packages/app-shell`) and never calls the API. The fixture IDs do not exist in the database. These surfaces must not be described as implemented.

- Auth: sign-in/session API exists (migration 0001); the sign-in screen is cosmetic and the shell's current user is a canned demo response.
- Home (`/workspace`): the layout exists; the content is fixture data, not a role-aware hub.
- Matters: full CRUD API exists (`/api/matters`); the matter list and detail screens render fixture data. No code in the web app calls `/api/matters`.
- Documents: metadata-only API exists (upload records filename/hash/size; no file bytes are received or stored). No document UI beyond fixture data.

Closing this tier is owned by the app shell rebuild (`docs/prds/app-shell-rebuild.md`), which replaces the fixture layer with real API wiring and a new design system. It runs as a parallel track to Redact and is a named dependency of the Redact Phase 2 review UI (`docs/prds/redact-2-review-output.md`).

### Planned (visible but not implemented)

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

- The user-facing product name is **Obiter** (decided July 2026). "Obiter" remains only as an internal identifier — `@obiter/*` package names, `--obiter-*` token prefixes, and existing planning docs — until a separate rename cleanup.
- Use "Home" in navigation for the top-level information hub. The implementation may keep `/workspace` until route cleanup is handled separately.
- Do not use "Atlas" as the product or architecture label for the Search surface.
- Use "Search" for the implemented legal source search surface.
- Use "Redaction" and "Verification" in navigation, not internal shorthand.
- Use "Evaluation" for Bench unless an engineering-only admin screen is being built.
- Keep legacy internal package, service, index, and route names stable only as temporary implementation identifiers unless there is a separate refactor for code ownership.

## Implementation Boundary

The current case law implementation keeps a PostgreSQL source record for fetched judgments, including provider metadata, content hash, source/XML/PDF URIs, raw Atom entry metadata, and hydrated document payloads when available. Meilisearch is a derived index for fast lexical retrieval, not the source of record. Find Case Law calls are queued as background hydration after Obiter-owned storage misses so the user-visible search path is not blocked on the external provider.
