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

### M1.25 comments and DOCX export: stable anchors and product comment placement (10 August 2026)

Context: S3 adds product comments after the S1 OOXML identity model, S1b
matter access layer, and S2 current-model route. The owner has settled that
comments are stored in the database and embedded in exported DOCX files. The
current API has no export route, so this decision keeps export package-only
and testable in `packages/ooxml`.

Decision: represent an anchor as `{ paragraphId, startOffset, endOffset }`,
where the id is the S1 paragraph identity and the offsets are zero-based,
half-open UTF-16 offsets into the concatenated model run text. Paragraph and
run indexes, screen coordinates, and raw XML offsets are prohibited. The
comment create request carries the body and anchor; the server binds the
comment to the current ready DOCX version as `anchorVersionId`. Comments are
document-scoped, with that version id retained as nullable provenance so a
stable paragraph can survive an S4 version change. If the paragraph or range
is absent after an edit, the comment remains stored as an orphan and export
fails closed. It is never silently re-anchored, deleted, or moved.

Create `packages/contracts/src/document-comments.ts` and re-export it. The
shared schemas cover the anchor, create request, list response, create
response, resolve request, and resolve response. Comment body is bounded
plain text. The shared comment record includes the document id, nullable
anchor version id, anchor, body, author display identity, resolution fields,
and timestamps. Raw XML, provider diagnostics, email addresses, and tokens
are not contract fields.

Create `packages/database/migrations/0014_document_comments.sql` as a new
organisation and matter scoped table. Store the anchor fields separately
from opaque JSON, together with document and nullable anchor-version
composite foreign keys, author identity and display-name snapshot, body,
resolution fields, and timestamps. Required identity fields are not nullable
because the table is new and empty; lifecycle and purge-tolerant provenance
fields are nullable. The migration is idempotent and additive, changes no
existing rows, and does not reuse 0013.

Keep comment SQL in `services/api/src/comments-db.ts`. List, create, and
resolve use the existing store pattern. Create and resolve each write their
comment mutation and one audit event in the same transaction. The only
permitted `database.ts` change is the two typed audit action literals
`document.comment_create` and `document.comment_resolve`; comment queries do
not belong there. Audit metadata contains ids only, never comment text or
model text.

Add `services/api/src/routes/comments.ts`, mounted additively in
`services/api/src/app.ts`, with GET and POST at
`/api/documents/:id/comments` and PATCH at
`/api/documents/:id/comments/:commentId/resolve`. Extend
`services/api/src/routes/document-route-shared.ts` to accept a required
matter access level while retaining its view default. List requires view;
create and resolve require edit. All routes use the shared authentication,
organisation, document, ready-DOCX, and S1b access sequence, return the
uniform document 404, and set `Cache-Control: no-store`. There is no delete
or unresolve route in S3.

Add a pure `serialiseDocxWithComments(document, comments)` package function.
It resolves each stable paragraph id, verifies the range, splits runs when
needed, and emits `w:commentRangeStart`, `w:commentRangeEnd`, the reference,
and a valid `w:comment` with escaped author, timestamp, and plain-text body.
Ids are deterministic numeric ids allocated above foreign comment ids. An
existing foreign `word/comments.xml` part is preserved and product comments
are appended. Missing comments relationships and content types are added
only when required. Invalid or unresolved anchors return a curated error and
no partial output; the input model is not mutated. With no product comments,
S1 clean-part byte identity remains unchanged.

Amend `docs/specs/documents/semantic-xml-equivalence.md` in the S3
implementation so the intentional product additions are allowed only at the
expected anchor and comments part. Foreign comments and every unrelated part
must still satisfy the S1 relation. Package tests pin model JSON anchor
stability, single-run, cross-run and empty ranges, foreign comment
preservation, relationship creation, id collisions, escaping, unresolved
anchors, no input mutation, and untouched-part byte identity. Route tests pin
view/edit access, organisation and document 404s, deleted and non-ready
states, no-store, schema validation, and same-transaction audits. P1, P2,
P3, P4, and P7 apply at this boundary.

### M1.25 single-author editing: typed model commands and locked immutable versions (11 August 2026)

Context: M1.25 S4 adds editing after the S1 OOXML preservation layer, the
S1b matter access gate, the S2 model route, and S3 comment anchors. The
relevant mutation and preservation surfaces are
`packages/ooxml/src/model.ts`, `packages/ooxml/src/parts/overlay.ts`,
`packages/ooxml/src/serialise.ts`, and `packages/ooxml/src/comment-anchors.ts`.
The API keeps document SQL in `services/api/src/database.ts`, while new domain
work belongs in `services/api/src/document-versions.ts` and the shared route
gates belong in `services/api/src/routes/document-route-shared.ts`.

Decision: use a small custom model-driven editor over the S2 typed renderer.
Do not add ProseMirror, Tiptap, Lexical, or another rich-text framework. The
client sends one additive `DocumentEditRequest` contract from
`packages/contracts/src/document-edit.ts`, containing `baseVersionId` and a
bounded non-empty ordered list of typed operations: `replace_run_text`,
`set_run_style`, `set_paragraph_style`, `insert_paragraph_after`, and
`delete_paragraph`. The request carries no serialised model, raw XML, storage
key, tenant id, or author identity. The main document story is the S4 edit
surface. The OOXML package exposes one command application entry point that
uses the existing source-preserving overlays and the existing serializer.
Style changes patch only direct `w:pStyle` or `w:rStyle` values. New nodes get
non-serialised model ids, and all invalid or partially applicable operation
lists fail without output.

Decision: apply edits server-side. The API reads the immutable base source,
parses it with `@obiter/ooxml`, applies the typed commands, and serialises
from that model. Clean parts remain byte-identical, untouched parts after an
edit remain byte-identical, and unknown XML plus foreign tracked-change
markup survive unless an explicit operation removes their containing node.
Tracked-change paragraphs cannot be structurally deleted, and the package
never edits inside opaque tracked-change subtrees. This prevents a client
model from silently dropping the source-preserving overlays required by S1.

Decision: `POST /api/documents/:id/edit` uses the shared resolver with edit
access. It sets `Cache-Control: no-store`, then follows session, organisation,
organisation-scoped document, edit-level matter access, ready-DOCX, request
validation, and base-current checks. Unknown, cross-organisation, deleted,
denied, non-ready, and non-DOCX states use the uniform document 404. A stale
base is an exact mismatch between the request `baseVersionId` and the
organisation-scoped document's `current_version_id`, returned as the existing
`conflict_detected` 409. The route is member-allowable for owners and
edit-level grantees, not restricted to `requireManageRole`.

Decision: `createEditedVersion` locks the active document row with `FOR UPDATE`
inside its transaction and repeats the base-current comparison under that
lock. It writes the new source object at the existing source-key CHECK shape,
then inserts immutable version N+1, updates `current_version_id`, and writes
`document.version_create` plus `document.edit` before commit. The response
contract is `{ documentId, versionId, versionNumber }`. The content SHA-256 is
computed from the final DOCX bytes. The edited version is `ready` for the
model surface with a null `text_object_key`; stale extracted text is never
copied and S4 does not add a second extraction path. Storage is compensated by
cleanup on a database rollback, while no committed database pointer can refer
to an unwritten object.

Decision: preserve the S3 anchor contract of stable paragraph id plus
half-open UTF-16 offsets. S4 does not re-resolve anchors by content or rewrite
stored offsets. The new model is the authority: an anchor that remains in
range resolves at its model location, while a removed paragraph or invalid
range remains an explicit unresolved comment for the S3 UI and export path.
S4 does not mutate the comments table or add comment data to its response.
This avoids a second anchor policy and makes paragraph deletion, text changes,
and comment orphaning explicit.

The applicable defect patterns are P1, P2, P3, P4, P7, and P10. The plan's
integration-head text is stale relative to the S4 task: `8dcea28` is the
post-S3 base used here. The U4 prompt's request for a version selector on the
S2 model route is a separate S2 amendment and is not included in S4.

### M1.25 tracked changes: typed nodes and immutable decisions (11 August 2026)

Context: M1.25 S5 extends the S1 source-preserving OOXML overlays and the S4
custom model edit path. The relevant package surfaces are
`packages/ooxml/src/model.ts`, `packages/ooxml/src/serialise.ts`,
`packages/ooxml/src/parts/overlay.ts`, `packages/ooxml/src/model-edits.ts`,
`packages/ooxml/src/text-run-edit.ts`, and `packages/ooxml/src/comment-anchors.ts`.
The relevant API surfaces are `packages/contracts/src/document-model.ts`,
`packages/contracts/src/document-edit.ts`,
`services/api/src/document-versions.ts`,
`services/api/src/routes/document-edit.ts`, and
`services/api/src/routes/document-route-shared.ts`.

Decision: add a typed `DocumentChangeWire` summary to the shared contracts
model and a top-level `changes` array to `DocumentModelWire`. The summary
maps `w:ins` to insert, `w:del` to delete, `w:moveFrom` and `w:moveTo` to paired
move nodes, and `w:rPrChange` and `w:pPrChange` to run and paragraph property
nodes. It carries a document-model id, source part and model location,
semantic text, direction or scope where applicable, the original lexical
OOXML id, and optional author and date. Source ranges and raw fragments stay
inside the OOXML runtime model. The field is additive with an empty default
for old model JSON, but the model store must regenerate a cached object that
has no own `changes` field, so an old S2 cache cannot hide foreign changes.
The change list route parses the source directly rather than trusting that
cache. This keeps P7 at the model, storage, API and UI boundary.

Decision: change recording is an additive `trackChanges` boolean on the S4
`DocumentEditRequest`, default false, not a second route. The server supplies
the trimmed session name with the S4 fallback to the session user id, one ISO
timestamp, and a document-unique decimal `w:id`; clients cannot supply any of
these values. In tracking mode, text replacement emits `w:del` with
`w:delText` for the old text and `w:ins` with `w:t` for the new text, paragraph
insertion wraps its new run in `w:ins`, paragraph deletion wraps ordinary runs
in `w:del`, and direct style changes add `w:rPrChange` or `w:pPrChange` with
the previous direct property state. The display name is used only as
`w:author`; it is not copied into audit metadata, errors, logs, or a database
field. The existing S4 path is unchanged when the flag is false.

Decision: new move recording is deferred because S4 has no move operation and
inventing one would expand the editor surface. S5 still decodes and lists
foreign move markup and accepts or rejects a valid `w:moveFrom` and
`w:moveTo` pair atomically. Accept removes move-from and unwraps move-to;
reject unwraps move-from and removes move-to. Orphan or ambiguous pairs fail
closed. Foreign changes remain source-preserved until an explicit decision.

Decision: add `GET /api/documents/:id/tracked-changes` with an optional
`versionId` query for view-level access, and
`POST /api/documents/:id/tracked-changes/decision` for edit-level access. The
shared route resolver selects a ready DOCX version for listing and enforces
the current pointer for mutation. The decision request is
`{ baseVersionId, action: 'accept' | 'reject', changeIds }`, with a non-empty
unique list capped at 100. The list response is
`{ documentId, versionId, versionNumber, changes }`; the decision response
reuses the S4 version response shape. Both routes set `no-store`, use the
uniform document 404, and apply the existing session, organisation,
document, and S1b matter-access gates without a per-route access copy.

Decision: accept or reject is an all-or-nothing package operation. Accepting
an insertion unwraps it and accepting a deletion removes it. Rejecting an
insertion removes it and rejecting a deletion unwraps it while converting
`w:delText` to `w:t`. Property accept removes the change marker and property
reject restores its saved property subtree. Every decision creates immutable
version N plus 1 through the S4 `FOR UPDATE`, exact current-pointer check,
source-key, compensation, and audit discipline. The path writes
`document.version_create` and a tracked-change accept or reject audit row in
the same transaction, with ids only in metadata and no display author name,
change text, XML, or diagnostics.

New generated wrappers and accept or reject transformations are intentional
exceptions at the requested source ranges in the semantic XML equivalence
document. Clean foreign changes and all untouched parts retain the S1
byte-identity guarantee. The applicable defect patterns are P1, P2, P3, P4,
P7, and P10. Move creation is explicitly deferred, and the U6 instruction
that foreign origin is visibly distinguishable is stale because OOXML carries
no reliable Obiter-origin marker without adding forbidden durable metadata.

### M1.25 multiplayer editing: bounded typed-operation reconciliation and polling (11 August 2026)

Context: M1.25 S6 adds multiplayer editing after the S4 immutable edit path
and the S5 tracked-change path. The relevant package surfaces are
`packages/ooxml/src/model.ts`, `packages/ooxml/src/model-edits.ts`,
`packages/ooxml/src/tracked-edits.ts`, `packages/ooxml/src/comment-anchors.ts`,
and `packages/ooxml/src/serialise.ts`. The relevant API surfaces are
`packages/contracts/src/document-edit.ts`,
`packages/contracts/src/document-collaboration.ts`,
`services/api/src/document-versions.ts`,
`services/api/src/document-collaboration-versions.ts`,
`services/api/src/document-presence.ts`,
`services/api/src/routes/document-edit.ts`,
`services/api/src/routes/document-collaboration.ts`,
`services/api/src/routes/document-route-shared.ts`,
`services/api/src/document-access.ts`, and `services/api/src/app.ts`.

Decision: use HTTP polling through the existing Hono API, with no websocket
or Redis dependency in S6. The new collaboration sync route reports the
organisation-scoped current version and ephemeral cursors. A presence update
route writes to a bounded process-local registry only. The registry expires
entries after 15 seconds, caps each document at 50 users and the process at
1,000 document buckets, binds user ids from the authenticated session, and
carries only a typed main-story cursor. It never stores document content,
comment text, display names, or audit rows. The editor polls the sync route
and reloads the existing model route when the current version id changes.

The actual branch does not contain a worker implementation or Redis runtime:
`services/worker/README.md` is a placeholder, `infra/docker/compose.yaml`
starts PostgreSQL only, and `services/api/package.json` has no Redis or
websocket client. Redis remains a future adapter seam, not an S6 prerequisite.
A multi-process deployment may omit presence from a poll that lands on a
different process, but this cannot affect document versions or content.

Decision: use a bounded server-side operation reconciliation algorithm over
the typed S4/S5 operations. It is OT-shaped but not a general OT framework,
and it is not a CRDT. The pure logic belongs in a focused `@obiter/ooxml`
module and receives parsed base and current documents plus the existing typed
operation list. Verbatim subtrees are opaque atoms and are never merged by
raw XML replacement.

If the request base is current, existing S4 operations apply normally. If it
is stale, only non-structural operations over an unchanged typed skeleton are
automatically reconciled. Text, direct run style, and direct paragraph style
fields have separate semantic footprints. Different runs, and independent
text and style fields, can merge. Opaque changes at a containing region,
missing targets, changed run or paragraph skeletons, insertions, deletions,
and overlapping footprints return a 409 conflict response with the current
version id and operation indexes. The current concurrent version is the
surfaced immutable conflict version; S6 does not create an empty duplicate.
The losing operation never silently overwrites it. A disjoint stale request
creates the next immutable version.

This restriction follows the identity choices in the S1 and S4 decisions.
`w14:paraId` and `w14:textId` are passed through, but absent ids and newly
inserted nodes use non-serialised model ids. S6 therefore does not claim to
merge stale structural edits where identity cannot be proved. This is a
conservative extension of the existing model rather than a speculative CRDT.

Decision: add `packages/contracts/src/document-collaboration.ts`, re-exported
from `packages/contracts/src/index.ts`. The contracts are strict and
additive. They cover a cursor `{ paragraphId, runId, offset }`, a presence
update `{ cursor: Cursor | null }`, a sync response containing
`documentId`, `currentVersionId`, `currentVersionNumber`, `changed`, and up
to 50 `{ userId, cursor }` participants, a merge request containing
`baseVersionId`, bounded client-generated `syncId`, existing typed edit
operations, and optional `trackChanges`, and a merge response containing the
version ids, number, sync id, and `outcome: merged | already_applied`. A
conflict response adds `currentVersionId`, `currentVersionNumber`, and unique
operation indexes to the existing `conflict_detected` error. No contract
contains source text, raw XML, comments, storage keys, filenames, display
names, or diagnostics.

Decision: add `services/api/src/routes/document-collaboration.ts` with
`GET /api/documents/:id/collaboration/sync`,
`PUT /api/documents/:id/collaboration/presence`, and
`POST /api/documents/:id/collaboration/merge`. Every route uses
`resolveCurrentReadyDocumentVersion` with required edit access, preserving
the session, organisation, organisation-scoped document, shared matter
access, ready-DOCX, and no-store order. The merge service validates the base
version and repeats the exact current-pointer check under `FOR UPDATE`.
There is no change to `documents.ts`, extraction, upload, or legacy routes.

Successful merges belong in
`services/api/src/document-collaboration-versions.ts` and use
the S4/S5 source-key, immutable version, compensation, and audit discipline.
A successful merge writes one ready DOCX version with a null text artifact,
then `document.version_create` and `document.collaboration_merge` in the same
transaction. The latter stores only ids, operation count, a canonical
operations SHA-256, and outcome. The `syncId` and operations hash are checked
under the document lock against the durable collaboration audit event, so a
retry of the same batch returns the original version without a second write,
while reuse for different operations returns 409.
Conflicts and presence are not audited. No version N is mutated.

The applicable defect patterns are P1, P2, P3, P4, P7, P10, P13, and P14.
P1 requires the existing all-part preservation tests around every merge. P2
requires curated conflict and storage errors with no raw content in durable
state. P3 requires the shared route gates for sync, presence, and merge. P4
requires typed semantic footprints. P7 requires one contracts module. P10
makes the narrow OT and structural-conflict semantics explicit. P13 requires
allowing disjoint stale edits rather than rejecting every stale base. P14
requires no ratio or metric with an unguarded empty denominator.

The plan's Redis wording is stale relative to the checked-out runtime, and
its phrase that a conflicting edit creates a new version is under-specified.
This decision records that the concurrent winner is the surfaced new version,
while the losing same-region request returns 409 and creates no duplicate.

### M1.25 page rendering: package images and table display (12 August 2026)

Context: the S2 wire model still has no typed table or image nodes. Letterhead
headers and footers are often a drawing plus a shaded table, so a text-only
margin band looks like the Word formatting was stripped.

Decision: keep the wire schema unchanged. Serve current-version image parts
through `GET /api/documents/:id/media?part=`, gated like the model route, and
restricted to image package paths. The route keeps an LRU cache of unzipped
image parts for at most 16 immutable versions per API process and serves later
image requests from that cache. The React page interprets preserved `w:tbl`
fragments and drawing extents for display only: React tables and `<img>`, never
HTML strings of OOXML. Binary media stays out of `model.json`. Page size,
margins, fonts, run size, paragraph spacing, and drawing boxes come from the
document's own twip and EMU values (plus `styles.xml` inheritance), not from a
product type scale. Header and footer stories are painted on the page (top and
bottom) rather than stacked in the body flow; letterhead bars come from a
shaded three-cell table or from flanking shapes around a logo, and footer text
sits on the shape fill. Header letterhead groups (navy bars plus a logo) are
laid out from DrawingML/VML coordinates rather than a synthetic grey table.
This is a block-flow layout engine: section page size and margins define a
content frame, body blocks paginate into that frame, and `wp:anchor` offsets
position floating drawings. Header and footer stories repeat on each page.
Columns come from `w:cols`. Floating wrap uses the drawing's wrap kind:
`wrapSquare` / `wrapTight` / `wrapThrough` inset the line, `wrapTopAndBottom`
skips the drawing's vertical band, and `wrapNone` does not affect text flow.
Body text boxes (`w:txbxContent` in an anchor) are painted in the drawing and
kept out of the body flow. Long paragraphs split across columns and pages at
measured line boundaries. Tight/through wrap is approximated as square; table
row splits and CSS exclusions are out of scope.
