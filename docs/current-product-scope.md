# Current Product Scope

## Purpose

This document records the product surface that should be visible in the app shell right now. Internal module names such as Atlas, Redact, Verify, Research, Vault, and Bench remain useful for architecture, but the user interface should use plain workflow names.

## Implemented Navigation

These sidebar entries should be active links:

- Home: the authenticated, role-aware information hub. This currently lives at `/workspace`.
- Matters: the matter list and matter detail shell.
- Search: the legal source search surface. It currently searches public UK case law through the Ormont API, Meilisearch, and Find Case Law fetch-on-cache-miss.

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
- Do not expose "Atlas" as the primary user-facing label for search.
- Use "Search" for the implemented legal source search surface.
- Use "Redaction" and "Verification" in navigation, not internal shorthand.
- Use "Evaluation" for Bench unless an engineering-only admin screen is being built.
- Keep internal package and service names stable unless there is a separate refactor for code ownership.

## Implementation Boundary

The current case law implementation stores indexed judgment records in Meilisearch. That is enough for the present search and case viewer workflow, but it is not the final durable source-of-record design. Canonical PostgreSQL/object-storage persistence remains follow-up work.
