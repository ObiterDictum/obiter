# Current Product Scope

## Purpose

This document records the product surface that should be visible in the app shell right now. Search is the canonical product and domain label for public legal-source discovery, retrieval, and stored case pages. Legacy `atlas` package, service, index, and route names are temporary implementation identifiers until a separate cleanup renames them safely.

## Implementation Status (verified against the codebase, July 2026)

Status is tracked in three tiers. "Implemented" means a user action reaches the real API and real data end-to-end — not that a screen exists.

### Implemented end-to-end (API + UI)

- Search: the legal source search surface. It searches Obiter-owned stored legal sources first and queues Find Case Law hydration in the background on misses. (App shell rebuild M3 confirmed `/search` and `/case/:slug` render on the `--obiter-*` design tokens and `@obiter/ui` components exclusively — no legacy styling remains. The restyle itself shipped in PR #24; M3 is the verification and dead-CSS removal pass.)

Search owns:

- `/search`
- `/cases/:caseId`
- `GET /api/search`
- `POST /api/search/fetch`
- `GET /api/search/documents/:documentId`

- Auth: sign-in, sign-out, self-registration, and password reset are wired to the real auth API (better-auth email/password + magic link + forgot/reset password). `useCurrentUser()` is backed by the real `GET /api/me`; signed-out users are redirected to `/sign-in` and session expiry is handled gracefully. Email verification is required on self-registration; that flow is server-side only (no dedicated verification product surface). Registration is org-less: a new user has no organisation until they create one explicitly via `POST /api/organisations`; an org-less user lands on Home's create-organisation surface, and org-scoped routes redirect them there. Password reset uses a single-use token; the request endpoint never reveals whether the email exists.

Auth owns:

- `/sign-in`
- `/forgot-password`
- `/reset-password`
- `GET /api/me` (returns `organisation: null` for an org-less user)
- `POST /api/organisations` (creates the signed-in user's organisation; single-org model)
- `/api/auth/*` (better-auth: sign-up, sign-in, sign-out, verify-email, magic-link, request-password-reset, reset-password)

- Home (`/`): for an org-less user, renders a create-organisation surface (matters and documents live inside an organisation). Once an organisation exists, renders the signed-in user's real matters and organisation from `/api/me` and `GET /api/matters`. No invented widgets — every value shown comes from a real endpoint. (The legacy `/workspace` path redirects to `/`.)

- Matters: the matters list, matter creation, and matter detail are wired to `GET /api/matters`, `POST /api/matters`, and `GET /api/matters/:id` via TanStack Query, with loading, empty, and error states.

Matters owns:

- `/matters`
- `/matters/:matterId`
- `GET /api/matters`
- `POST /api/matters`
- `GET /api/matters/:id`

- Documents: matter detail supports DOCX, text-layer PDF, and TXT multipart upload (up to 25 MB) through `POST /api/matters/:matterId/documents`; the document detail route renders immutable versions and can start a document-linked Redaction run. PDF inputs produce extracted text for Redaction, not a redacted PDF. Scanned/image-only PDFs require OCR: standalone runs are rejected and matter versions are retained as failed.

Documents owns:

- `/matters/:matterId/documents/:documentId`
- `GET /api/matters/:matterId/documents`
- `GET /api/documents/:id`

- Redaction: `/redact` and `/redact/:runId` provide organisation-scoped standalone-text and DOCX, text-layer PDF, or TXT upload detection review, decisions and finalized outputs. Standalone paste/upload remains the default; document-linked runs can be started from a matter document detail after extraction. Uploads accept DOCX, text-layer PDF, and TXT up to 25 MB; scanned/image-only PDFs require OCR, so standalone runs are rejected and matter versions fail extraction. Output remains redacted or pseudonymised text plus the audit report, not a redacted PDF. The API exposes an audit-report download. Detection runs server-side vendored Rampart inference from Obiter's pinned `qarlus/rampart` mirror plus the deterministic UK supplement, with merged spans and an auditable detector version. If model loading or inference fails, runs complete with Rampart deterministic heuristics plus the UK supplement (`heuristics+supplement`) and record degraded mode. Desktop-local inference remains future work.

Redaction owns:

- `/redact`
- `/redact/:runId`
- `GET /api/redaction-runs/:runId/audit`

### API implemented, UI is demo fixture

(None. The fixture layer (`createPhaseZeroShellSnapshot`, demo `MeResponse`) was deleted in the app shell rebuild M2; these surfaces are now wired to real data. To populate any environment, including development, register an account through the sign-up screen — registration is org-less, so the new user then creates an organisation from Home, after which matters and documents are created through the UI.)

### Planned (visible but not implemented)

These entries can appear in the sidebar to show product direction, but they must be visually marked as planned and must not look like active tools:

- Drafting
- Research
- Documents
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
- Use "Home" in navigation for the top-level information hub. Home lives at the root `/`.
- Do not use "Atlas" as the product or architecture label for the Search surface.
- Use "Search" for the implemented legal source search surface.
- Use "Redaction" and "Verification" in navigation, not internal shorthand.
- Use "Evaluation" for Bench unless an engineering-only admin screen is being built.
- Keep legacy internal package, service, index, and route names stable only as temporary implementation identifiers unless there is a separate refactor for code ownership.

## Implementation Boundary

The current case law implementation keeps a PostgreSQL source record for fetched judgments, including provider metadata, content hash, source/XML/PDF URIs, raw Atom entry metadata, and hydrated document payloads when available. Meilisearch is a derived index for fast lexical retrieval, not the source of record. Find Case Law calls are queued as background hydration after Obiter-owned storage misses so the user-visible search path is not blocked on the external provider.
