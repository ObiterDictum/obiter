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

### OOXML fidelity layer: lossless overlays and shared model identity (10 August 2026)

Context: M1.25 S1 adds `@obiter/ooxml` for DOCX parsing and serialisation. The
slice must preserve unknown OOXML, tracked changes, and every part that the
parser does not modify, while later viewer, comments and editing slices need a
shared model and stable anchors. Considered typed overlays with preserved
subtrees, whole-part modification replay, and a generic DOM; considered a
package-local wire schema versus the shared contracts package; considered
serialised derived IDs versus a non-serialised identity side map.

Decision: use typed overlays with source-preserved nodes for editable and
content-bearing XML parts, and opaque whole-part preservation for binary and
currently uneditable parts. A clean part is emitted from its original payload;
a dirty part patches only the changed model nodes. The exact golden guarantee
is that touched parts regenerate under semantic XML equivalence and every
untouched part is byte-identical. Preserve `w:ins`, `w:del`, `w:moveFrom`,
`w:moveTo`, `w:pPrChange` and `w:rPrChange` as opaque subtrees in S1, including
author and timestamp attributes. Define semantic XML equivalence in the
sibling `docs/specs/documents/semantic-xml-equivalence.md` and implement it in
`packages/ooxml/src/equivalence.ts`. Pass through `w14:paraId` and `w14:textId`
when present, allocate model-internal IDs otherwise, and never emit derived IDs
as OOXML attributes. Put the model wire schema in `packages/contracts`, with
`@obiter/ooxml` consuming it. Keep the conformance corpus in
`packages/ooxml/fixtures/`, preferring deterministic builders. The package
uses JSZip and fast-xml-parser as its only new external runtime dependencies,
with source-preserving serialisation rather than parser reserialisation. The
workspace glob and package exports register it without a tsconfig edit.

### M1.25 matter document access: per-matter ownership and shared grants (10 August 2026)

Context: M1.25 S1b inserts per-matter access before the document viewer. The
existing API in `services/api/src/authz.ts`, `services/api/src/routes/matters.ts`
and `services/api/src/routes/documents.ts` enforces organisation isolation but
has no matter-level membership. Owner decisions 4, 4b, 4c and 4d require
matter ownership by the creator, sharing at matter scope, two levels, and no
retrofit of the existing redaction, upload, extraction or detail routes.

Decision: add `matter_shares` in migration 0013 with an organisation id,
matter id, grantee user id, text access level checked as `view | edit`, creator,
creation time and a generated share id. Scope the matter foreign key by the
existing `(id, organisation_id)` key, enforce one grant per matter and grantee,
and index both tenant matter access and tenant grantees. Use text plus a CHECK
rather than a PostgreSQL enum so the migration remains additive and safe to
reapply. Soft deletion retains grants, but active-matter queries make them
inaccessible; restoring a matter reactivates the retained grants. A future hard
delete must explicitly handle grants.

Put all per-matter resolution in `services/api/src/document-access.ts`.
`resolveMatterAccess` checks the active organisation-scoped matter in this
order: `matters.created_by`, an edit grant, a view grant, then denial. The
owner always has effective edit access. A required-level argument makes view
and edit checks distinct, and `requireMatterAccess` composes the resolver with
`ensureOrgUser` on every request. Denial, unknown, cross-organisation and
soft-deleted matter ids use the uniform `matter_not_found` 404. There is no
admin override because the current API has no `can(role, capability)` pattern;
`requireManageRole` remains a separate action gate and does not replace matter
access. Ownership never falls back to a document creator, admin or grantee.

Manage shares only through the new `services/api/src/routes/document-access.ts`
router: `GET /api/matters/:matterId/shares`, `POST` at the same path, and
`DELETE /api/matters/:matterId/shares/:shareId`. The owner alone may manage
shares. Matter resolution is organisation-scoped and returns the uniform 404
for unknown, cross-organisation or soft-deleted matters. A grantee must be a
current member of the same organisation and cannot be the owner. Grant and
revoke mutations lock and recheck the active matter, mutate the share, and
write an audit row in one transaction. Use `matter.share_grant` and
`matter.share_revoke` on `matter_share` entities, with ids and access level only
in metadata. Add those two action literals to the existing audit input union as
the smallest required extension.

Put the access level, access decision, share grant, request and response
schemas in `packages/contracts/src/index.ts`, additively, including
`matter_share_not_found` for a missing share on a known matter. The access
layer is standalone in S1b. No existing consumer is gated until S2 and later
M1.25 slices import `requireMatterAccess`, which avoids the P3 defect of
separate sibling checks.

### M1.25 read-only document viewer: wire model and derived serve surface (10 August 2026)

Context: M1.25 S2 serves the S1 OOXML model after S1b's matter access layer.
The existing API resolves documents and current versions in
`services/api/src/database.ts`, while upload writes derived `layout.json`
objects without a database column. The existing detail and extraction routes
must remain unchanged.

Decision: add `serialiseModelJson` and `parseModelJson` in
`packages/ooxml/src/model-json.ts`, using the single
`DocumentModelWire` schema in `packages/contracts/src/document-model.ts`.
Serialisation accepts an `OoxmlDocument` but writes only its logical
`document.model`. Source part bytes, overlays, anchors and dirty state never
enter JSON. Parsing validates JSON into `DocumentModelWire`; it does not
claim to reconstruct an `OoxmlDocument`. The guarantee is exact deep equality
of the wire model for `parseModelJson(serialiseModelJson(document))`,
including source-preservation fragments and stable ids, with curated errors
for malformed input.

Serve the model through a new `GET /api/documents/:id/model` router mounted
additively in `services/api/src/app.ts`. The route uses `ensureOrgUser`, an
organisation-scoped `getDocument`, then S1b's
`requireMatterAccess(..., 'view')`, followed by a current-version check for
`ready` and `docx`. It serves the current pointer only and does not accept a
version selector in S2. A denied 404 from the access helper is mapped to the
model route's `document_not_found` 404, so unknown, cross-organisation,
deleted, denied, non-ready and non-DOCX cases share one HTTP and body
contract without model storage reads. The route sets `Cache-Control:
no-store` and leaves the existing detail, upload and extraction routes
untouched.

Use a column-free lazy derived object at the validated source key's
`/model.json` sibling:
`org/{org}/matters/{matter}/documents/{document}/versions/{version}/model.json`.
`services/api/src/document-model-store.ts` owns cache reads, source parsing,
canonical model writes and wire validation. It uses a process-local in-flight
promise guard. Cross-process duplicate writes are safe because immutable
source versions produce deterministic JSON. It reads only validated source or
model keys and never the quarantine prefix. The local storage allowlist must
be extended minimally to permit `model.json`; no migration or model key
column is introduced.

Return a contracts wrapper containing `documentId`, `versionId`,
`versionNumber` and nested `model: DocumentModelWire`, validated before the
response is emitted. Do not return storage keys, filenames or raw XML. The
renderer is not in `@obiter/ooxml`: the owner-applied U2 prompt owns a React
renderer in `packages/app-shell`, using typed nodes and safe markers with no
HTML strings. P1, P2, P3, P4 and P7 apply to this boundary. The current wire
schema does not yet contain typed table, image, list or section nodes, so S2
must not invent a second model shape to satisfy those parts of the U2 prompt.

### M1.25 PDF import-to-view: stored extraction serve surface (10 August 2026)

Context: S2b adds `GET /api/documents/:id/pdf-view` after S2. PDF is an
import-to-view surface only. `services/api/src/routes/documents.ts` already
extracts PDF content through `services/api/src/document-extraction.ts`, writes
the extracted text to the version's `/text` sibling, and writes the validated
layout to the `/layout.json` sibling. The text key is recorded in
`document_versions.text_object_key`; the layout key is derived and has no
column. S2 already establishes the route and store pattern in
`services/api/src/routes/document-model.ts` and
`services/api/src/document-model-store.ts`.

Decision: add a new `services/api/src/routes/document-pdf-view.ts` router and
one additive mount in `services/api/src/app.ts`; leave
`services/api/src/routes/documents.ts`, `document-extraction.ts`,
`document-upload.ts`, and `database.ts` unchanged. The route runs
`ensureOrgUser`, an organisation-scoped `getDocument`, then
`requireMatterAccess(..., 'view')` from `services/api/src/document-access.ts`,
then requires the current pointer to identify a `ready` version whose
`fileType` is exactly `pdf`. Unknown, cross-organisation, deleted, denied,
non-ready, and non-PDF states use the uniform `document_not_found` 404. A
matter access denial is mapped from the helper's matter 404 to the document 404. The route sets `Cache-Control: no-store` before all responses. It does
not audit reads because the canonical gate checklist requires audit events for
mutations, not these read-only model or PDF serve routes.

Put storage key derivation, canonical key checks, text and layout reads, JSON
parsing, and `documentTextLayoutSchema` validation in a new
`services/api/src/document-pdf-view-store.ts`. Derive only the canonical
`/text` and `/layout.json` siblings from the validated source key, verify the
recorded text key matches, and never read `/source` or a quarantine prefix.
Missing or malformed ready artifacts fail closed through a generic storage
error without exposing provider or parser diagnostics. The route does not
rerun PDF extraction.

Put this exact additive response in `packages/contracts/src/index.ts`, using
the existing layout schema and the S2 version wrapper pattern:

```ts
export const documentPdfViewResponseSchema = z.object({
  documentId: z.string().min(1),
  versionId: z.string().min(1),
  versionNumber: z.number().int().positive(),
  text: z.string(),
  layout: documentTextLayoutSchema,
})
```

The response carries `documentId`, `versionId`, `versionNumber`, the stored
extracted `text`, and the stored `layout`. Both are required because layout
segments refer to offsets in the extracted text. Do not return source bytes,
storage keys, filenames, raw PDF data, parser diagnostics, or OOXML model
fields. PDF remains outside the model, editing, comments, round-trip, and
export paths. The U5 surface must state that the view is not editable.

The implementer must add focused route and store tests for the access matrix,
uniform 404s, ready and PDF filtering, no-store, response validation, safe
storage failures, and the absence of source or quarantine reads. P2 and P3
apply at this boundary. P7 applies because the wrapper is shared through
`packages/contracts` and the stored layout is validated at the read boundary.
