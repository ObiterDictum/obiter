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

### Redaction run authorization and deletion (August 2026)

Redaction runs inherit access from their matter: standalone runs are owned by
`created_by`, while linked runs require the matter owner or an active share at
the requested level. No administrator override exists for live run access.
Every linked lifecycle mutation uses one lock order: matter, document,
redaction run(s), then matter share, with ids sorted within each group. It probes
ids without locks, then locks and revalidates each live parent before locking the
run. Joined `FOR UPDATE` across tables is avoided. Matter-share revocation uses
the matter-first prefix, so a revocation that wins the matter lock cannot be
bypassed by a stale pre-lock authorization decision.

Document and comment writes take that same matter-first prefix. The edit,
collaboration merge (including an `already_applied` replay), tracked-change
decision, comment create and comment resolve transactions acquire the matter row
`FOR UPDATE` alone, then re-evaluate edit-level access in a separate statement on
a fresh snapshot, then take a `FOR SHARE` on the acting user row, all through
`services/api/src/matter-lock.ts`, before they lock the document. The lock and the
re-check are deliberately separate statements: a `FOR UPDATE` that waits on a
revocation does not re-run the qual it read before the wait, and a share
revocation or downgrade leaves the matter row unchanged, so evaluating the share
predicate in the locking statement would authorise on the pre-revocation
snapshot. The route-level resolver still rejects early, but it is not
authoritative. Explicit matter-share grant, revocation and downgrade serialise on
the matter lock. Member removal takes no matter lock: it locks the departing user
row `FOR UPDATE` and deletes that user's shares, so the writer's user-row
`FOR SHARE` is the second serialisation point. A write that owns a lock first
commits and the revocation follows; a revocation that owns it first makes the
write observe the removed share or membership and return the concealed document
404, leaving no version, current-version pointer change, comment row, audit row
or candidate object. Re-reading the user row closes the `created_by` branch of
the access predicate, which deleting shares cannot change.

The matter-first prefix now also covers eight named write paths: matter `PATCH`,
matter soft-delete and restore, document soft-delete and restore, document upload
(`createDocument` in `database.ts`), and actor-side share grant and revoke. The
matter and document paths acquire the matter row `FOR UPDATE`, re-evaluate edit
access in a separate statement, and take the acting user's `FOR SHARE` before
writing. Cascade restore uses `lockDeletedMatterForEdit`, which locks the
soft-deleted row and returns its `deleted_at` as text so the child cascade matches
only the children that deletion took down. Actor-side share management
(`grantMatterShare`/`revokeMatterShare` in `routes/document-access.ts`) keeps its
`matters.created_by` owner check and adds the same membership `FOR SHARE`, so a
removed owner's in-flight grant or revoke observes the cleared membership and
returns the concealed matter 404. Upload reads and extracts the body before the
lock and writes the object after the write transaction commits, so no external
I/O is held under the row lock and a denied or failed upload leaves no stored
object. Each path keeps its existing concealed code: matter operations and share
management return `matter_not_found`, document operations return
`document_not_found`.

Those eight paths do not complete P0.13. The redaction-run write family still
embeds `matterAccessPredicate` inside the matter `FOR UPDATE` and takes no
acting-user `FOR SHARE`, so it retains the stale-share-subplan window and never
observes member removal. `selectMutationRun` in `redaction-database.ts` is the
shared mutation gate for span decisions (`recordSpanDecision`), finalize
(`finalizeRedactionRun`), run soft-delete and restore
(`softDeleteRedactionRun`/`restoreRedactionRunWithAudit`) and redetection
(`createRedetectionRun`); `lockLinkedRunParents` in `redaction-run-creation.ts`
is the same shape for linked-run creation. Extending the lock-then-recheck plus
membership `FOR SHARE` shape to those paths is a tracked follow-up and is not
part of this change.

Direct reads and lists exclude deleted runs. The sole deleted-run exception is
`GET /api/redaction-runs/:runId/audit`: after the live resolver misses, the route
uses a narrow organisation-scoped deleted-row resolver available only to
`owner`/`admin`, and it never resolves deleted matter access or object-storage
keys through the live boundary. Deleted-run audit access is by known id; there is
no listing path for deleted runs. Restore and redetection preserve the same
order, including deterministic redaction-run lineage locking, and re-check
parent/lineage state before updating.

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
is absent after an edit, the comment remains stored as an orphan and is never
silently re-anchored, deleted, or moved. The export route (see the M1.25 DOCX
export decision below) skips such comments rather than failing the download;
the 10 August "fails closed" wording is superseded by that decision.

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
lists fail without output. `insert_paragraph_after` accepts either the
historical flat `text` field or a bounded `runs` array that reuses
`set_run_style` / `set_run_emphasis` property names, so mixed formatting
survives save without a stored-operation migration.

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
is stale, every base paragraph that has a `w14:paraId` must still exist in
current, in order, with unchanged run `w14:textId` identities. Concurrent
`insert_paragraph_after` edits appear as extra paragraphs without those ids
and are not a skeleton failure. Two inserts after different identified
anchors merge. Two inserts after the same identified anchor both apply;
incoming inserts use the existing `applyDocumentEdits` insertion-count order
(placed immediately after the anchor, the same placement a single-author
`flowIds` chain uses). Sequential model ids shift after a round-tripped
insert, so operations that only have those ids still conflict once extras
exist. Text, direct run style, and direct paragraph style fields have
separate semantic footprints. Different runs, and independent text and style
fields, can merge. An insert whose identified anchor is missing, a stale
`delete_paragraph`, reordered or rewritten identified paragraph or run
skeletons, opaque changes at a containing region, missing targets, and
overlapping footprints return a 409 conflict response with the current
version id and operation indexes. The current concurrent version is the
surfaced immutable conflict version; S6 does not create an empty duplicate.
The losing operation never silently overwrites it, and a merge never drops
an incoming operation to succeed. A disjoint stale request creates the next
immutable version.

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
restricted to image package paths. Responses are built only by
`createDocumentMediaResponse`, which sets `Content-Disposition: attachment`
and a non-executable Content-Security-Policy while preserving each part's
`Content-Type` so the frontend can fetch blobs for `<img>` rendering. The route
keeps an LRU cache of unzipped image parts for at most 16 immutable versions
and 64 MiB of retained image bytes per API process, evicts the least recently
used entry when either bound is crossed, and serves later image requests from
that cache. A version whose image parts exceed the byte budget is served but
not retained. The React page
interprets preserved `w:tbl` fragments and drawing extents for display only:
React tables and `<img>`, never HTML strings of OOXML. Binary media stays out
of `model.json`. Page size, margins, fonts, run size, paragraph spacing, and
drawing boxes come from the document's own twip and EMU values (plus
`styles.xml` inheritance), not from a product type scale. Header and footer
stories are painted on the page (top and bottom) rather than stacked in the
body flow; letterhead bars come from a shaded three-cell table or from flanking
shapes around a logo, and footer text sits on the shape fill. Header letterhead
groups (navy bars plus a logo) are laid out from DrawingML/VML coordinates
rather than a synthetic grey table. This is a block-flow layout engine: section
page size and margins define a content frame, body blocks paginate into that
frame, and `wp:anchor` offsets position floating drawings. Header and footer
stories repeat on each page.
Columns come from `w:cols`. Floating wrap uses the drawing's wrap kind:
`wrapSquare` / `wrapTight` / `wrapThrough` inset the line, `wrapTopAndBottom`
skips the drawing's vertical band, and `wrapNone` does not affect text flow.
Body text boxes (`w:txbxContent` in an anchor) are painted in the drawing and
kept out of the body flow. Long paragraphs split across columns and pages at
measured line boundaries. Tight/through wrap is approximated as square; table
row splits and CSS exclusions are out of scope.

### M1.25 list markers and notes: numbering levels on the wire (13 August 2026)

Context: the S2 wire model stored numbering instances (`w:num`) without their
abstract levels, so the page renderer could not paint `1.`, `(a)`, or bullets.
Footnote and endnote stories were parsed but never shown.

Decision: parse `w:lvl` values onto each numbering instance as an optional
additive `levels` array. Missing `levels` on a cached `model.json` forces
regeneration, matching the S5 `changes` cache rule. The React page paints
markers from those levels and from paragraph or style `w:numPr`, and paints
footnote or endnote marks from `w:footnoteReference` / `w:endnoteReference`.
Note bodies are laid out after the main story on the page. Note paragraphs
are read-only. Creating list operations and editing headers, footers, or
notes remains out of scope.

### M1.25 editor formatting: direct emphasis and list indent (13 August 2026)

Context: `set_run_style` / `set_paragraph_style` only patch style ids.
Bold, italic, and underline already painted from preserved `w:rPr`, but
the editor could not persist toggles. List markers painted from numbering
levels, but indent/outdent/continue had no write path.

Decision: add `set_run_emphasis` (`w:b` / `w:i` / `w:u`) and
`set_paragraph_numbering` (`w:numPr`) overlay ops. Style picker uses the
existing `set_paragraph_style` op. List creation and restart remain out of
scope. Emphasis applies to every run in the selected paragraph; intra-run
splitting is out of scope.

### M1.25 DOCX export: source bytes plus product comments (13 August 2026)

Context: the editor Export control downloaded reconstructed plain text. Word
comments already had a package writer (`serialiseDocxWithComments`) but no
authenticated download route.

Decision: add view-gated `GET /api/documents/:id/export` with optional
`versionId`. Ready DOCX only. When the document has no comments, return the

immutable source bytes unchanged. When it has comments, parse that version,
validate each comment anchor against that version's model, and embed only the
comments whose anchors resolve; unresolvable anchors are skipped, never a
blanket 500. The skipped count is surfaced in the
`x-obiter-comments-skipped` response header and in the audit row, and the
editor shows a banner when comments were skipped. Audit `document.export`
with matter, version, `commentCount`, and `skippedCommentCount` only: no
filename, object key, or comment bodies. The toolbar downloads that package
instead of a `.txt` reconstruction.

### M1.25 find and undo: local draft history (13 August 2026)

Context: the editor could not search the open document or reverse unsaved
edits. Server versions stay immutable; undo does not rewrite history.

Decision: find walks current main-story and insert draft text and jumps to
the hit caret. Undo pops a local snapshot of drafts, inserts, deletions,
extra runs, and formatting. Checkpoints are taken before typed edits,
insert, delete, and formatting. Saved versions are unchanged. Redo and
in-run highlight painting are out of scope.

### M1.25 table cells: wrap and edit with body paragraphs (13 August 2026)

Context: table cells already painted `ModelParagraph`, but wrapping used the
full column width and there was no proof that cell typing used the body
edit path.

Decision: wrap each cell to its width percentage (or an equal share of the
column) minus cell padding. Typing in a cell emits the same `onWordEdit`
operations as body text. A typed table model and row splits stay out of
scope.

### Public search, changelog, and health: no user authorization (30 August 2026)

Context: `GET /api/search`, `POST /api/search/fetch`,
`GET /api/search/documents/:documentId`, `GET /api/changelog`, and
`GET /api/health` resolve a session when one exists but do not require one.
That is a product policy for published legal authorities, the product
changelog, and API liveness, not an omitted gate. The only place it was
visible was the handlers.

Decision: keep these five routes anonymous. They exist to serve public
judgment search of already stored authorities, GitHub-backed release notes,
and a minimal liveness probe. Anonymous `POST /api/search/fetch` is stored-only: it
must not queue hydration, call Find Case Law, or write Postgres or
Meilisearch. Anonymous `GET /api/search/documents/:documentId` may still answer a
miss from the provider in a read-only process, as it did before, but it is
charged to one shared anonymous bucket (a server constant, not a
caller-supplied id or IP) and it never persists: an anonymous request causes no
corpus or index write even when the process owns a writer. Authenticated callers may
queue bounded background hydration, request foreground live results, and fetch
a document on a miss, but every provider-reaching path crosses one in-process
`LegalSourceHydrationGate`
(`services/api/src/legal-search-hydration-budget.ts`). The gate reserves the
authenticated user's budget before the operation runs, deduplicates equivalent
in-flight work by a canonical key (a query key and a `document:` key never
collide), and releases the reservation on success, error, rate limit or
cancellation. A request the budget rejects never reaches the provider, the
corpus or the indexer. Deduplication shares one in-flight result across
subjects, so a concurrent caller for the same key is answered without a second
upstream fetch and without consuming its own miss. The detached detail pass a
foreground fetch starts is admitted as its own lease without charging the miss
window again, so while that lease is unexpired every provider request it makes
is inside the lease bound rather than outside it. The ledger counts unexpired
leases, not every still-running operation: once a lease passes
`LEGAL_SEARCH_HYDRATION_LEASE_MS` its operation drops out of the count, so a
second operation can be admitted while the first still runs. Bounding every
running operation would need lease renewal or cancellation, which is
deliberately not implemented here. The MOJ rate limiter
(`MOJ_FIND_CASE_LAW_RATE_LIMIT`, one process-wide window) remains a per-process
backstop; the cluster-wide upstream HTTP allowance is a separate shared budget
(see the Find Case Law request-budget decision below). The gate bounds
unexpired leases and per-subject misses in a rolling window; in the default
single-process configuration it
also bounds the number of retained per-subject windows. Admission state is
cluster-visible by default; see the shared-ledger decision below.

**Superseded for the API by the corpus-only decision (30 September 2026,
below).** `services/api` no longer constructs the hydration gate, the shared
hydration ledger or the shared request budget, and no request path reaches
Find Case Law. The 30-August statement that anonymous `POST /api/search/fetch`
is stored-only now holds for every caller, and the anonymous document route no
longer answers a miss from the provider. The gate, ledger and budget remain in
the tree, unreferenced by a request path, for an explicit indexing run.

Search and changelog must never return
matter data, client documents, redaction source or output, session or
organisation records, auth secrets, or Meilisearch admin keys. Production
health must return only `{ status: 'ok', service: 'obiter-api' }` and must never
expose environment, version, port, database or Meilisearch configuration,
Rampart settings, matter data, or secrets. Development health additively
includes the API commit SHA and checkout root for local provenance checks; these
fields are not exposed outside development. Adding an auth requirement is a
product change and must fail `allows anonymous callers on deliberately public
routes` in `services/api/src/routes/public-access.test.ts` rather than landing
silently.

### Hydration admission is a cluster-wide Postgres ledger (29 September 2026)

**Retained but unused by the API since the corpus-only decision (30 September
2026, below).** No request path constructs this ledger; it remains because the
code and migration are shared with the explicit indexing boundary.

Context: the per-process gate above bounded each API process separately, so N
replicas gave N per-subject windows, N anonymous buckets and N in-flight
queues on one shared egress IP. Its `LegalSearchHydrationBudget` was an
in-memory map, and an advisory lock alone would not help: a lock serialises
writers without persisting a window, so it neither survives a restart nor
holds any state to share.

Decision: admission state lives in the application database (`DATABASE_URL`),
in `legal_hydration_leases` and `legal_hydration_misses` (migration
`0028_legal_hydration_ledger.sql`), reached through
`PostgresLegalHydrationLedger` (`services/api/src/legal-hydration-ledger.ts`).
The application database is the boundary every API process already migrates at
boot and may write. It is deliberately not the legal corpus: a lane is
configured with `CORPUS_DATABASE_URL` alone and therefore has no corpus writer,
and licensed source material must not accumulate operational rows. The corpus
read-only mode is the reason the ledger cannot live there, not a limitation to
work around.

One transaction per admission takes
`pg_advisory_xact_lock(hashtext('legal_hydration_admission'))`, sweeps expired
leases and out-of-window misses, counts live leases against `queueMax`, and, for
a charged admission, counts the subject's misses in the rolling window before
inserting the miss and the lease. The lock only makes check-and-record atomic;
the window is the persisted rows, so it survives a restart and is shared by
every replica. The in-flight count reads `expires_at > now()`, so a crashed
replica's lease, or an operation that outlives its lease, stops counting when
the lease expires even if no sweep has run. The admission transaction sets
transaction-local `lock_timeout` (2s) and `statement_timeout` (5s), so a wedged
lock holder (a stalled event loop, a paused process, a partition after
`begin`) makes admission fail closed within the bound instead of stalling
every replica. A failed or timed-out admission returns `unavailable`, the gate
refuses the operation, and the route answers `503 storage_unavailable` with no
provider call and no corpus write: a database outage or a wedged lock fails
new hydration closed, while stored reads, which run on the corpus pool and
never cross the admission boundary, keep serving.

Cross-replica same-key deduplication is deliberately not claimed. The
in-process single-flight map remains an optimisation that avoids a duplicate
fetch inside one process; it is not the source of global truth. Two replicas
admitting one canonical key both take a lease and both charge a miss, which is
why the canonical key is not persisted at all. The ledger stores an opaque
lease id and the server-verified subject (a better-auth user id, so one user
shares one window across sessions, or the `anonymous:shared` sentinel); no
query text, canonical key or matter data reaches a row or a log line. The
detached detail pass a foreground fetch starts is admitted as an uncharged
lease, so while that lease is unexpired every provider request, including Atom
pagination and the detail fetches, is inside the lease bound. The per-subject
miss window and the unexpired-lease bound are therefore cluster-wide; adding
replicas no longer multiplies them. The MOJ HTTP-rate limiter remains per
process, so it is a per-replica backstop rather than the cluster allowance.

Deliberately not done here: a second datastore (Redis) for admission state; a
cross-replica result cache. The lease lifetime
(`LEGAL_SEARCH_HYDRATION_LEASE_MS`, default five minutes) is
the ceiling on how long a crashed replica can hold a slot. The shared upstream
HTTP request budget that was also deferred here is implemented separately; see
the Find Case Law request-budget decision below.

### Find Case Law HTTP attempts draw on one cluster-wide budget (29 September 2026)

**Retained but unused by the API since the corpus-only decision (30 September
2026, below).** No request path constructs this budget; it remains, with the
provider package's `MojRequestBudget` seam, for the explicit indexing boundary.

Context: every Find Case Law path behind the hydration gate could still reach
the provider once per HTTP attempt, and admission bounded operations rather
than attempts. One search walk can spend one Atom-page charge per page, then
one LegalDocML charge per detail fetch and, when the XML path fails, a second
HTML charge for the same judgment; a document-detail miss spends one; the
withdrawal and bulk-ingestion walks spend one per URI. The per-process
`MOJ_FIND_CASE_LAW_RATE_LIMIT` window is copied into every API process, so N
replicas on one egress IP gave N allowances, and the balance of the provider's
real published allowance was never established from this repository.

Decision: charge one shared rolling window immediately before each actual
upstream HTTP attempt, on the application database (`DATABASE_URL`), in
`legal_moj_request_charges` (migration `0029_moj_request_budget.sql`). The
window is a count of persisted rows inside one transaction under
`pg_advisory_xact_lock(hashtext('legal_moj_request_budget'))`; the lock only
makes check-and-record atomic, the rows are the window, so it survives a
restart and is shared across replicas. The database clock is the authority for
both the write and the count, so replica clock skew cannot widen the window.
The charge is the provider package's one seam (`MojRequestBudget.charge`), so
the accounting is per attempt and every caller — Atom pagination, LegalDocML,
HTML fallback, detail and document fetches, retries — draws on it without a
second code path. An attempt is charged even when the network call then fails;
a URI refused by the SSRF/origin guard before dispatch is not charged.

Fail-closed: the charge transaction sets transaction-local `lock_timeout`
(2s) and `statement_timeout` (5s). A database outage, a wedged lock holder or
a timed-out statement returns `unavailable`, the provider dispatches nothing,
and a provider-reaching route answers `503 storage_unavailable`. A queued
background hydration is the one exception: it is best effort, so a budget it
cannot charge makes no upstream attempt and the request keeps its
`hydration_queued` transport outcome, degrading to the stored result the poll
returns exactly as a provider outage does. Foreground live search and
document-detail fetches fail closed with 503. A full window
returns `rate_limited` with the wait until the oldest in-window charge frees a
slot, derived from the database clock, so the caller has a meaningful
retry-after rather than a fixed guess. A charge row is a timestamp and nothing
else: no URL, query text, subject, user identity or matter data is persisted,
so the ledger cannot reconstruct what was fetched or by whom.

Ownership boundary: the shared budget covers the API replicas, which share the
application database every API process already migrates at boot. It does not
cover `services/legal-ingestor`, whose `DATABASE_URL` is its own corpus-writer
connection and which therefore cannot reach the application ledger; wire it to
an operational connection without a new ownership/deployment decision and its
Find Case Law traffic stays outside the shared window. `MOJ_FIND_CASE_LAW_REQUEST_BUDGET`
(default 1000 attempts per rolling five minutes) is an operator assumption,
not a verified provider allowance: it preserves the previously used per-replica
cap as a cluster maximum, so it can only reduce upstream traffic, but whether
1000 is the provider's true allowance remains unproven here. The per-process
limiter is kept and composed before the shared charge, so it can only tighten
the window, never widen it, and a request it refuses never spends a shared
slot.

Deliberately not done here: a Redis counter; a per-subject HTTP budget (the
hydration ledger already bounds per-subject misses and in-flight work); and
wiring bulk ingestion and the withdrawal checker to an operational ledger,
which needs a new credential and deployment decision because their database
connection is the corpus writer.

### The user-facing API is corpus-only (30 September 2026)

Context: the API's search and document routes reached Find Case Law directly
(foreground live results, queued background hydration, a detached detail pass
and document-detail fetch-through), bounded by the hydration ledger and the
shared request budget. That made the provider a runtime dependency of a
user-facing request and, because the ingestor sits outside the shared window,
left the production-wide provider budget unresolved. Product decision: the
user-facing API must never contact the National Archives. National Archives
access is permitted only during an explicit document-indexing run.

Decision: `services/api` is corpus-only. `POST /api/search/fetch` and
`GET /api/search/documents/:documentId` read Obiter-owned records in Postgres
and the derived Meilisearch index and nothing else. There is no provider
client, no hydration gate, no request budget and no corpus write on a request
path: the route module imports no provider fetch function, `runtime.ts`
constructs neither `PostgresMojRequestBudget` nor
`PostgresLegalHydrationLedger`, and a structural test scans every non-test API
source file (all source extensions, the whole package tree) plus the static
import graph from both production entry points for the provider fetch names,
provider module specifiers, provider public-entry imports outside an explicit
pure-symbol allowlist, direct `fetch(` calls outside the one allowlisted file
(`routes/changelog.ts`, the fixed GitHub changelog endpoint), and the National
Archives host outside a configuration default, so a future call fails the
suite. A miss
answers honestly under the existing contract: search returns its stored-only
empty (`no_match`, or `recognised_not_held` for a recognised citation) with
`diagnostics.liveProviderSearched: false` and `hydrationQueued: false`; a
document miss returns `404 document_not_found` with "Document is not held in
the local corpus". Neither claims a job was queued, because nothing will run.
A provider outage cannot turn a miss into `503 storage_unavailable`. Stored
documents stay readable: every stored read path is unchanged.

Callers: `foregroundLiveResults` is accepted and ignored so an older client is
not rejected; a request that sends `true` is answered with
`diagnostics.foregroundLiveIgnored: true` so the client can tell the flag had
no effect, and the app shell no longer sends it. The API never produces the
`hydration_queued` transport outcome; the UI's bounded recheck is retained
defensively and never fires. The document route serves full text from the
index or the stored `document_json`; a summary-only row (a PDF-only judgment)
serves its stored metadata, which the case view renders with its full-text
unavailable state, rather than being completed from the provider.

Retained deliberately: migrations `0028_legal_hydration_ledger.sql` and
`0029_moj_request_budget.sql`, `moj-request-budget.ts`,
`legal-hydration-ledger.ts`, `legal-search-hydration-budget.ts` and the
provider package's `MojRequestBudget` seam are unchanged and currently
unreferenced by a request path. They are the accounting and admission
machinery an explicit indexing run needs; this change does not delete them and
does not delete a migration. `source-store.ts`'s write store is likewise
retained, unbound from any request path.

Not done here: wiring bulk ingestion and the withdrawal checker to a shared
operational ledger; and any deployment change. The production egress topology
is unverified from this repository, so this change claims only that the API no
longer contributes upstream traffic, not that production is fully covered.

Withdrawal check: `services/legal-ingestor` `withdrawal:check` re-fetches stored
URIs from Find Case Law. No unit, timer, cron entry or container schedules it
in this repository or on the inspectable host, and this decision does not
authorise it as a standalone polling job. The licence obligation to remove
material no longer published (TNA licence clause (a)(iii)) is therefore
unresolved: the decision is whether withdrawal detection folds into an explicit
indexing run or is handled another way. No withdrawal safeguard is removed by
this change.

### Document edit operations: property families without a second compatibility path (31 August 2026)

Context: the editor wire had seven operations. Fonts, colours, alignment,
spacing, and indent had no representation, so each control was free to invent
one. Inserted runs already carried bold, italic, underline, and style id
(#132). Extending that with a second insert shape or a renamed emphasis
operation would have required a stored-operation migration.

Decision: keep the existing seven `type` names and add one property operation,
`set_paragraph_format`. Do not rename `set_run_emphasis`. Run character
formatting stays on that type and on `editRunSchema`, additively.

Naming: property operations are `set_{run|paragraph}_{family}`. They patch
direct formatting on an existing node. Structural operations are
`insert_*`, `delete_*`, or `replace_*`. They add, remove, or replace nodes or
text. Families stay separate: style id, numbering, run character formatting,
and paragraph layout are four ops, not one properties bag.

Composition: omitted or `undefined` means leave the current direct value.
`null` means remove that direct formatting so the style inherits. A concrete
value writes it. At least one family field must be present, including an
explicit `null`. A new property is an optional field on the existing family
object. Persisted operations that omit it keep parsing. There is no column
and no migration.

Bounds: client strings and numbers are untrusted. Font names cap at 64 XML-safe
characters. Colours are `auto` or six hex digits. Font size is Word
half-points, 2 to 1638. Spacing and indent are twips, 0 to 31680 (22 inches).
Highlight is Word's closed colour list. Vertical align is
`superscript | subscript | baseline`. Alignment is `left | center | right | both`.

E3b: `insertPayload` reads the run family from preserved fragments onto
`editRunSchema`. E3c: those readers take the prefix from the fragment, not a
hardcoded `w:`.

Structural operations later (tables, images, footnotes, headers, breaks,
cross-references, table of contents) fit the same rules and do not get schemas
in this change. A table insert is `insert_table_after` with bounded cell
counts, not a nested document model. An image is an insert that names an
already-stored part, not raw bytes. Notes, headers, and breaks are inserts
that target a story or a paragraph edge. Cross-references are property or
insert ops that name an existing bookmark id. Commit those schemas when the
apply path exists. Committing them now would freeze a guess.

Rejected: a parallel `set_run_properties` type; renaming `set_run_emphasis`;
theme colour objects; underline styles beyond the existing boolean; language
and bidi; keep-with-next; schemas for tables, images, notes, headers, breaks,
or TOC.

### Merge spans: union overlapping model and supplement ranges (2 September 2026)

Context: `mergeSpans` in `packages/redaction-policy/src/merge.ts` dropped a
supplement span whenever it overlapped a Rampart span, then recomputed every
suggestion from category alone. A truncated model span therefore discarded a
correct National Insurance or sort-code match, and a date of birth already
marked `redact` was flipped to `keep`. Archived PRD F21 said the model wins
on overlap.

Decision: when a deterministic supplement span overlaps a model span, emit
one span covering the union of the two ranges. Picking a winner discloses
the loser's extra characters; the safe outcome is to cover both. Carry
`category`, `source`, `confidence`, and `id` from the longer contributing
span (the detector that covered more of the token). On a length tie, keep
the Rampart span (`rampart_model` or `rampart_deterministic`) rather than
the UK supplement. Suggestion is `redact` if either contributor is `redact`;
otherwise keep a suggestion already present on a span and only call
`suggestedAction(category)` when it is missing. Do not pass `isDateOfBirth`
at merge time; that flag is applied upstream in `rampart-map.ts`.

### Span text is re-derived from the source at the Rampart boundary (12 September 2026)

Context: upstream's `mergeSpans` partial-overlap union widens `start`/`end`
but keeps the winning span's `text`, so a merged span's text can disagree
with its own offsets. `mapRampartSpans` trusted that text whenever it did
not trim a person name. Finalize and the .docx burner both require
`text.slice(start, end) === text`, so a run whose detection produced such a
union returned `redaction_span_integrity_error` (409) on every finalize
attempt and could never be completed.

Decision: `mapRampartSpans` always derives `text` from
`output.text.slice(start, end)`; the carried `text` is no longer trusted.
The fix lives at the product boundary because `@obiter/rampart-inference`
is kept byte-faithful to upstream and re-vendoring would erase a change made
there (see `packages/rampart-inference/README.md`). Every other
offset-changing operation in the vendored package (adjacent-connector merge,
particle rescue, window repair, premask projection) already re-slices from
source; the partial-overlap union was the only one that did not, so the
invariant was enforced on one path but not its sibling. `preferred()` still
chooses the label, source and confidence: on a cross-detector partial
overlap the whole union is redacted under the winner's category and
confidence, but its text is the exact union substring. The union-coverage
decision is unchanged.

### Person-name heuristics run per detection, before the span union (12 September 2026)

Context: `mapRampartSpans` applied `trimLeadingTitles` and
`isDeniedPersonName` to whatever span it was given. Both are written for a
span the model returned as one detection, and both are wrong once
`policy.mergeSpans` has unioned two detections, because the union covers
bytes from both. Trimming the union's head can advance past a losing
detection's characters (an address detection that starts `Dr`), and denying
the union on a newline discards both contributors when only one contains the
break. P2.39 removed the finalize 409 that used to surface either loss, so
they are silent. A 300-document corpus and a 50-document length probe
produced no merged spans at all, so neither exercised the path.

Decision: `normalizePersonDetections` in
`packages/redaction-policy/src/rampart-map.ts` trims and denies each
contributing detection before the union, and `mapRampartSpans` no longer
applies either heuristic; its contract is now pure mapping over already
normalised spans. The literal `Mr James Smith` and `Jones\nLaw` constructions
in the board item do not reproduce the loss: the first trims the losing
person detection's own honorific, the second puts the break in both
contributors. The regression tests use a non-person loser with a
title-shaped prefix and a break in exactly one contributor.

Not changed: `policy.mergeSpans` still takes the winner's `category` and
`confidence` for the whole union, so a `keep`-category winner can still
disposition bytes a `redact` loser contributed. The pinned model emits no
`keep` category except the premasked URL heuristic, so this is latent; it is
resolved by the P0.31 decision below. `detectNer` also performs its own
cross-window union inside `@obiter/rampart-inference` before the product
boundary, so on a multi-window document an inner partial union still reaches
this normaliser as a single span. The 50-document length probe produced no
inner partial union; the P0.31 decision below stops that inner merge from
discarding a redact contributor.

### Overlap reconciliation owns coverage and disposition (P0.31)

Context: the vendored `policy.mergeSpans` inherits the preferred detection's
`label` for the whole union, so a `keep`-category winner can disposition bytes
a `redact` detection contributed. Partial overlap widens coverage but keeps
the winner's label; full containment collapses to the winner and can drop a
redact loser's exclusive bytes. P0.30 fixed the per-detection heuristics but
left this third instance of the same pattern — a property of one detection
applied to a span that is several — because the category is decided _by_ the
merge. It is latent on the pinned model: DATE/DOB are not emitted, and URL is
the only keep label and is premasked. It is reachable through premask
projection (a model span touching an `[URL]` sentinel projects over the URL's
whole raw range) and through any later checkpoint that emits DATE.

Decision: the product owns overlap reconciliation in
`reconcileRampartSpans` (`packages/redaction-policy/src/rampart-map.ts`),
which `redaction-detection.ts` calls instead of the vendored
`policy.mergeSpans`. Every overlap emits the byte-union, and a union
containing any `redact`-required detection redacts. Category, source and
confidence still come from one real contributing detection, chosen by the
same preference order as upstream (score, then length, then a deterministic
source), so a disposition disagreement can only move the outcome toward
over-redaction. The union's category names the detection that won preference,
matching the rampart/supplement union in `merge.ts`; it is not a claim that
every byte in the union is of that category.

Trade-off: a union of a keep detection and a redact detection now redacts the
keep detection's bytes too, and a containment that previously collapsed to a
contained winner now covers the container's full range. Both are the safe
direction; the cost is over-redaction of a URL's bytes when a redact detection
overlaps them. Explicit reviewer decisions are unchanged: `override_keep`
still keeps a redact-suggestion union, and `override_redact` now covers the
whole union rather than the winner's bytes.

Not changed: `premask`'s internal heuristic union still uses the vendored
`policy.mergeSpans`. It only changes the masked string the model reads — the
heuristic spans themselves reach the product boundary and are reconciled
there — so it cannot affect a disposition.

Vendored exception: `detectNer` used to resolve its own per-window overlaps
with the same vendored `policy.mergeSpans`, one layer below the product
boundary, where `reconcileRampartSpans` cannot recover the contributors. The
reviewer drove the real `detectNer` with a mock tokenizer and classifier: a
seam-overlapping URL (`keep`) unioned a `GIVEN_NAME` (`redact`) into one keep
span and discarded the contributor before the product saw it. No supported
upstream interface exposes unmerged window spans (`detectNerWindow` and
`planTokenWindows` are private; `detectNer` is the only entry point), so this
is the one deliberate departure from byte-faithful vendoring: `detectNer` now
drops only exact duplicate detections and returns genuinely overlapping
detections as separate contributors for the product to reconcile.
`packages/rampart-inference/README.md` records the upstream tarball, the exact
divergence and the rule a future re-vendor must preserve.

Reachability: the multi-window loss is synthetically demonstrated through the
real `detectNer`; the pinned checkpoint (`qarlus/rampart@c3221c5`) emits no
DATE/DOB and premasks URL, so URL-as-model-label is vestigial, and neither the
50-document length probe nor the 300-document corpus produced an inner
partial union. The fix is preventive and safe-directional, not a response to
an observed corpus miss. A future checkpoint that emits DATE or URL at a seam
makes the disagreement ordinary rather than exotic.

Forward only: stored `redaction_runs.spans_json` and `detector_version` are
historical records and are never rewritten. The new `reconcile@1` component in
`detector_version` distinguishes runs produced under this policy. Re-detection
creates a new run (`redaction-redetect.ts`) rather than mutating the original,
but the current redetect path only accepts runs that were not model-detected,
so a pre-fix `model+supplement` run cannot be re-detected in place and remains
as recorded; a targeted re-reconcile of those runs is a tracked follow-up.

### Rampart DATE/DOB labels are aspirational (2 September 2026)

Context: a finalized redaction disclosed `12 March 1979` after a date-of-birth
cue. `GROUP_TO_LABEL` in `packages/rampart-inference/src/ner/classifier.ts`
drops unknown groups, and it has no DATE or DOB entry.

Findings: the shipped checkpoint `qarlus/rampart` at revision
`c3221c5cd838eb69a249ab40f8b442483865f233` has no DATE or DOB in `id2label`.
The cached config under `~/.cache/obiter/rampart-models` lists only the
name, contact, identifier, and address groups already mapped. Adding DATE
or DOB to `GROUP_TO_LABEL` would not fire.

Decision: leave `GROUP_TO_LABEL` without those keys. Keep the DATE and DOB
rows in `packages/redaction-policy/src/rampart-map.ts` as a map for a future
checkpoint that emits them. Detect dates of birth in the UK supplement when
a cue precedes the date; do not add an ungated date pattern (hearings,
citations, and page references). `mergeSpans` does not pass
`isDateOfBirth`, so the supplement span must already carry suggestion
`redact`.

### Document edit operations: range addressing on set_run_emphasis (3 September 2026)

Context: Bold applied to every run in the caret paragraph because
`set_run_emphasis` was addressed only by `runId` and the client listed every
run. Intra-run splitting was left out of scope in the 13 August 2026
formatting decision. Selecting two words therefore formatted the whole
paragraph.

Decision: keep the existing `set_run_emphasis` type. Accept either `runId`
(today's whole-run form) or `paragraphId` plus `from` and `to`
(paragraph-relative character offsets). Exclusive, enforced with
`superRefine`, the same pattern as `text | runs` on `insert_paragraph_after`
(#132). Reuse `runPropertyFields` from #135 so every run property gains
range addressing, not only bold. Bound `from` and `to` as integer offsets
from 0 to the document edit text limit. Reject an inverted or empty range.
Additive optional fields: persisted whole-run operations keep parsing. No
new operation type and no migration. Tracked range splits have no
`rPrChange` writer, so the server refuses a range `set_run_emphasis` under
tracking (`model-node-not-editable`) instead of silently dropping it, and the
client holds and surfaces the slot; the Home emphasis controls disable for a
partial selection while Track Changes is on. Tracked range formatting is
unsupported, not silently accepted. Whole-run emphasis under tracking is
unchanged.

Rejected: a parallel range operation type; renaming `set_run_emphasis`;
attaching a character range to `runId`.

### Home character formatting: strikethrough, highlight, vertical align (28 September 2026)

Context: the Home ribbon painted Bold, Italic and Underline and disabled
Strikethrough, Highlight, Superscript and Subscript as placeholders. The edit
contract, the OOXML writer and the saved-history reader already carried
`strikethrough`, `highlight` and `vertAlign`, but the client formatting draft
(`PendingEmphasis`), the control-state projection, the save plan and the paint
projection only restated bold/italic/underline. Enabling the buttons without
those would have painted a change no save carried.

Decision: extend the existing one formatting owner. `PendingEmphasis` and the
paint projection carry the three properties; `collectFormatOperations`
whitelists them for both the run and range forms; `formatControlState` reads
them from the same effective, painted paragraph as the existing flags; the
saved-history `emphasisOf` reader includes them so an Undo across a save
reverses them. No second formatting owner and no new operation type.

Semantics: highlight is a value control with a default (`yellow`) and a
release (`none`); superscript and subscript are mutually exclusive because
they share one `vertAlign` slot, and a second click returns to `baseline`. A
mixed or partial selection reads unpressed and one click makes it uniform,
matching Bold. Font family, size, colour and clear formatting keep their
placeholders; they are not properties the ribbon writes in this change.

Tracked changes: a range `set_run_emphasis` is already refused server-side; the
Home controls hold and surface that refusal rather than dropping the
formatting. Whole-run emphasis under tracking is unchanged.

Rejected: a per-control formatting store; a colour picker for highlight; new
`set_run_emphasis` operation types for the new properties.

### Document edit operation batches: one coordinate space (14 September 2026)

Context: `replace_run_text` updates a run's model text but not its source
anchors, so a later range emphasis in the same request addressed offsets that
no longer described the run and the save was rejected as invalid (#205, E44).
Composition needed a stated contract rather than an incidental property of
operation order.

Decision: a `DocumentEditRequest` operation list is a batch, not an ordered
program. Every operation addresses the paragraph text as it stands after all
`replace_run_text` operations in that batch, so listing an emphasis before its
replacement does not change what it emphasises. `replace_run_text` is the only
operation that establishes replacement text; `insert_paragraph_after`
establishes text for a paragraph that did not exist and is addressed by
`paragraphId` alone. `set_run_emphasis` addresses a paragraph through
`paragraphId` plus half-open `from`/`to` character offsets in that
post-replacement text, or a whole run through `runId`. A `runId` addresses a
run of the stored version, never a run an earlier split in the same batch
created.

Text is normalised once, at the contract boundary: a CRLF pair and a lone CR
are the same logical break as LF and are stored as LF, because a break
serialises to one `w:br` element and re-parses as one character. A
text-wrapping `w:br` is that character; a page or column break is structure:
it occupies no text offset and survives a text edit unchanged. Classification
has one owner, `isTextWrappingBreak`, shared by the parser, the model anchors
and the text-replacement path.

Within a batch, several replacements touching one run apply in list order and
each replaces the whole run text, so the last one wins. Overlapping emphasis
ranges merge per property with the later operation as the last write, which is
why an explicit `w:val="0"` can appear where an earlier range had set that
property. Third-party and direct API clients must treat offsets as addressing
this one space, not the pre-replacement document. Validation rejects an
inverted or empty range, an offset beyond the paragraph text, a range that
would split a surrogate pair, and an operation list that is empty or larger
than the operation cap, all as `validation_failed` (400).

Failure is atomic: the API parses, applies and serialises the whole batch
before any database work, so a rejected batch writes no version, no audit row
and no stored object. The coordinate space above is shared by every path that
reads an offset: the parser, the shared edit contract, replacement
composition, the formatting-range locator, comment and text anchors, and the
serialiser all read a text-wrapping `w:br` as exactly one `\n` and a page,
column or unrecognised break as structure that consumes no editable offset.
`comment-anchors.ts` owns the one source-order traversal over a run's `w:t`
elements and text-wrapping breaks, so a range boundary after a break lands on
the character the user selected rather than one short per break. A range that
covers only a text-wrapping break styles the run carrying the break; it never
reaches the neighbouring text. A range whose boundary cannot be mapped
faithfully, including a run whose anchors do not reconstruct its model text,
fails closed with `validation_failed` rather than misformatting; invalid
bounds are never clamped to nearby text.

### Document drafts: addressability, containment and reload persistence (14 September 2026)

Context: applying a paragraph style to a paragraph that had been inserted but
not yet saved produced `set_paragraph_style` against the client-side insert id,
which has no server identity. The API rejected the batch as
`validation_failed` (400), but the draft stayed in React state, so
`collectEditOperations` recomputed and resent the same unaddressable operation
on every later save while legitimate work accumulated behind it. No save ever
succeeded, the message named no risk, and a reload discarded the draft because
unsaved edits lived only in `useState` (E45).

Decision: three rules, each owned in one place.

_One: every operation is addressable._ `planDocumentSave` partitions draft
state into slots the loaded model can address and slots it cannot, before any
batch is built. An `insert_paragraph_after` carries its own paragraph style, so
a style chosen on a pending paragraph rides on the insert rather than becoming a
separate operation against a client id. A slot whose target is absent from the
model is reported and withheld, never sent. The API validation is unchanged.

_Two: a rejected batch is contained, not retried verbatim._ A
`validation_failed` for a batch that passed addressability triggers
`containRejection`, which removes one slot at a time from the end of the covered
list and re-sends the rest, capped at twelve attempts. A rejected batch writes
no version, so probing costs requests but never history; the first batch that
commits is the only one recorded. The removed slot moves to a held list, still
visible and still present in local storage, and is cleared only by an explicit
discard. The save state machine is `saved | unsaved | saving | failed | stale`,
and only a resolved API response advances it.

_Three: unsaved drafts survive a reload._ A minimal payload — changed run text,
pending inserts, deletions, emphasis and paragraph style, plus held changes — is
written to `localStorage` under
`obiter.document-draft.<schemaVersion>.<organisationId>.<userId>.<documentId>.<tabId>`.
The versioned zod schema is validated on every read; a payload that fails, names
another scope, or is older than seven days is removed rather than applied. The
payload records the `baseVersionId` it was built against: on load, a mismatch is
reported as stale and never applied to the newer version. The per-tab key keeps
two tabs on one document independent. Sign-out clears every stored draft.

Rejected: clearing the whole draft on a 400 (destroys valid work and typed
text); a server dry-run endpoint and operation-index reporting (new API surface
for a client-side addressing error the client can decide); client-side
duplication of the OOXML validator (two validators drift).

Consequence: `DocumentEditOperation` and the edit route are unchanged. The
boundary added is browser storage, which holds privileged matter text, so it is
versioned, scope-keyed, validated on read and cleared on save, discard and
sign-out.

### Stage 1 legislation search: stored Acts with withheld amended text (September 2026)

Context: search covered judgments only. Stage 1 adds UK Public General Acts
2020 onwards as a second federated group on `POST /api/search/fetch`.

Decision: store Acts in `legislation_documents` plus addressable
`legislation_provisions` (migration 0020), keyed by legislation.gov.uk
`/id/` URI identity with label paths such as `section/13/2`. Ingest reads
the documented CLML `data.xml` (version-neutral, XSD-declared, stable IdURI
and RestrictExtent attributes) rather than `data.akn`, politely at one
request per 5 seconds per the re-fetched `Crawl-delay: 5`, into Postgres
only; `rebuild-legislation-index.ts` derives the separate
`legislation_provisions` Meilisearch index afterwards, so the ingestor is
never a second writer. Per-provision currency comes from the per-Act
`/changes/affected/` feed's `ukm:Effect Applied` attribute with client-side
`ukm:Section` filtering and `rel="next"` paging, never from the HTML
yet-to-be-applied heading, which is whole-Act level. Exact citations
(chapter numbers, short titles, aliases, section forms) resolve from
Postgres; keyword queries read the provisions index with a provisional 0.35
floor (stricter than the judgment 0.25 because provision boilerplate
inflates keyword scores; re-sweep before trusting). A provision with
recorded unapplied effects serves an amended-not-held notice with the
official link and never its text; ambiguity resolves visibly, never to a
silent winner. Secondary legislation is explicitly next, not dropped.

Fix-up: the negative result distinguishes what is proved from what is merely
unresolved. A parsed chapter citation (`2099 c. 1`) is authoritative: year and
number are the canonical identity, so an absent chapter is a genuine
not-held. A failed _title_ lookup is not: the directory is partial and the
fold is imperfect, so a whole Act-title request that resolves to no stored Act
returns an unresolved-title suppression (`legislationTitleUnresolved`, outcome
`legislation_title_unresolved`) that says only that no exact title matched,
never that the Act is absent. Whether a query is a whole-title request or a
clause about one is decided by phrase structure over a closed title grammar,
not by sentence casing. A title run is the words before `Act <year>` in which
each word is a name, a number, or one of the grammar's fixed joining words.
The grammar is compiled in and never mined from the directory, so adding or
dropping a stored title cannot move how an unrelated query classifies. A query
that is a stored title with only the final year changed is a title request
whatever its casing. Otherwise a held title inside the run is stripped and the
remaining words are the outer enactment's own: when they are a title phrase
and the held title is a bracketed amendment parenthetical, the query is a
standalone outer title even though it embeds held titles
(`Worker Protection (Amendment of Equality Act 2010) Act 2010` suppresses and
serves nothing); when the residue is not a title phrase, or the held title is
an unbracketed separate mention, the containment is prose evidence and the
query stays on the keyword path (`duties under Equality Act 2010`, `the
Equality Act 2010 and the Human Rights Act 1998`). The boundary is
conservative: the required sentence-initial and lowercase prose pairs route
consistently, an unresolved title is never an authoritative not-held, and the
one residual is an all-lowercase nested outer title whose shape is not a
stored title's year variant
(`worker protection (amendment of equality act 2010 and human rights act 1998)
act 1999`), which without a lexicon is indistinguishable from a lowercase
clause. A standalone request may arrive with sentence punctuation, balanced
quotes, the terminal `(repealed)` annotation or the conventional terminal
`, as amended` qualifier — bounded presentation metadata normalised away
before the shape test — so `Children Act 1989.`, `"Children Act 1989"` and
`Children Act 1989, as amended` suppress instead of keyword-serving unrelated
provisions; arbitrary trailing words, unrecognised parentheticals and any
longer `as ...` clause are left in place, so `Children Act 1989 extra`,
`Children Act 1989 (Public Lavatories)` and `Children Act 1989, as amended by
the Courts Act 2003` stay prose. The stored-title directory hands out frozen
snapshots of frozen entries, so no caller can mutate an array or an entry and
reclassify a later query. A relaxed separator-insensitive title key that
matches more than one stored Act is ambiguous (`legislationAmbiguous`), never
a selected winner. A schedule citation that names a paragraph but no schedule
(`Sch. para. 2 Equality Act 2010`) is underspecified rather than absent: the
response carries `legislationScheduleGuidance` (the path-derived,
parser-compatible example plus the Act) and the outcome
`legislation_schedule_underspecified`, so the signed-in search renders a
resubmittable citation instead of the generic no-match copy. The lookup key strips only the terminal `(repealed)` status
annotation legislation.gov.uk appends, folds apostrophes by deletion, hyphens
to spaces, `&` to `and`, and drops the filler token `etc`, so the canonical
citation and the typed variant converge on the stored title.

Fix-up: extraction completeness is validated, not assumed. Each CLML
`Legislation` tag declares `NumberOfProvisions`, verified against a real
Act to count every `P1` open including `BlockAmendment` inserts (quoted
new-law text for another Act, correctly carrying no document `IdURI` and
correctly never a row), so the check compares `P1` rows against the
declaration and never total rows (sub-provisions always exceed it). A
mismatch stores flagged (`provision_count_note`, migration 0021) and is
reported in the ingest summary; it never fails the document, because exact
equality is unachievable by construction and failing on it would drop whole
Acts over legitimate quoted text. The affected-changes feed likewise has no
server-side provision filter: a filtered query is silently ignored and the
whole-Act feed returns, so per-provision currency pages the whole feed and
filters client-side on document-scoped `ukm:Section` URIs.

Fix-up: the legislation keyword call is bounded like every stored lookup.
`searchKeywordProvisions` races `searchLegislation` against the same 2s
deadline its Postgres reads use, and passes the deadline's `AbortSignal`
through the Meilisearch client, which forwards it to `fetch` — so a hung
engine request is aborted at the socket, not merely abandoned. Before this,
`settleSearchHalf` caught rejections but not hangs: a never-resolving
`legislation_provisions` search held the route's `Promise.all` open
indefinitely even when the judgment half had already answered, contradicting
the claim that the two halves are independently bounded. A deadline failure is
a failed legislation half (P1.35's `legislationSearchFailed`), never a
completed empty or a `no_match`: a usable judgment hit is kept and the response
marks partial coverage, and with no usable hit from either half fetch answers
`503 search_incomplete`. The race owns the engine promise, so a value that
settles after the deadline is discarded rather than surfacing as a stale
result or an unhandled rejection, and the single deadline timer is cleared on
every outcome.

### Act contents hierarchy: Parts and Schedules as rows (September 2026)

Context: whole-Act contents listed sections only; `legislation_provisions`
held no Part or Schedule-container rows, so the Equality Act 2010 rendered
as 234 undifferentiated sections while its schedules stayed invisible
(corpus-wide check during #176). CLML is typed — Part, Pblock (crossheading),
P1group, P1, P1para, P2 — with schedules mirroring the P1..P5 shape, and the
parser read P1 and below, dropping everything above.

Level census (sampled across 1998–2026 Acts incl. the dev anchors): primary
Parts (`part/N`) with optional Chapters (`part/N/chapter/M`), Pblocks
(crossheadings at Act, part, chapter, schedule and schedule-part levels),
P1groups (no IdURI, not addressable), P1 sections (flat IdURIs like
`section/100`); schedules (`schedule/N`) with optional internal Parts
(`schedule/N/part/X`), Chapters and crossheadings over P1 paragraphs
(`schedule/N/paragraph/M`); P2..P5 below. Containers may lack an IdURI in
some Acts (2023/55 carries 23 such Pblocks) and then are not rows.
Inserted-amendment provisions carry hierarchical IdURIs
(`part/2/section/100/kn1`) while base provisions are flat, so parentage
comes from CLML nesting, never label-path prefixes.

Decision: emit rows for every addressable container — Part, Chapter,
Schedule, crossheading (Pblock) — alongside P1..P5 (migration 0022 adds
`kind` plus `parent_label_path`; the parent is the nearest addressable
ancestor in the XML stack). Crossheadings are carried, not dropped: they
are addressable and are the only grouping level in part-less Acts (Human
Rights Act 1998 groups entirely by crossheadings), so dropping them would
leave most of the corpus flat again. P1group Titles are not carried (no
IdURI, no stable identity to row on). The Act page builds a tree of
containers plus P1 rows (sections and schedule paragraphs) in document
order and never sorts numerically, so inserted s. 13A stays between ss. 13
and 14. Withheld counts in the banner now cover every listed content row
(sections and schedule paragraphs), with wording "X of Y provisions";
containers are headings, never withheld, and are excluded from both counts
(the effects pass flags provision rows only). Container rows never enter
the derived Meilisearch index: they are headings with no searchable body,
so keyword search semantics are unchanged. Because ingest skips unchanged
Acts by content hash, the CLI gained `--force-reparse` to re-extract after
parsing changes; it goes through the same effects pass as a changed Act and
rows are only replaced once that pass has succeeded (a failed feed aborts
before any write, an unreadable one preserves known-good flags), so
withheld flags survive the row rewrite and text can never become servable
through it. The migration leaves pre-0022 rows with kind = NULL rather
than a default, so the transitional window is visible and fail-closed: a
document that still holds unclassified rows serves 503 for its Act page
(never a flat list of mis-classified provisions) until the force-reparse
rewrite fills in real kinds. The gate flag and the contents are read in
one statement, so they share one snapshot and the rewrite (a single
transaction) can never land between the two reads and leave a torn,
incomplete tree served as 200.

### Organisation invite role grants are bounded by the inviter's role (10 September 2026)

Context: `POST /api/organisations/:organisationId/invites` gated on
`requireManageRole`, which admits owners and admins, and inserted the
caller-supplied `role` verbatim. `createOrganisationInviteInputSchema.role`
permitted `owner`, so an admin could invite an address they control as
`owner`; the invitee accepted and `moveUserAndDeleteEmptyOrganisation` wrote
that role, making the invitee strictly more privileged than the admin who
invited them. The invite route is the only role-granting surface in the
product.

Decision: an actor may grant at most the role they themselves hold — owner may
invite owner/admin/member, admin may invite admin/member, and member cannot
invite at all. An admin requesting `owner` gets a 403 `forbidden`, not a
silent downgrade to admin. The clamp is `canGrantRole` in
`services/api/src/authz.ts`. Owner is a strict tier above admin: rename,
organisation update and member removal all require `requireOwnerRole`, so
granting owner is the only action that dissolves that tier. Rejection over
silent clamp is deliberate — RULES.md forbids silent fallbacks, and silently
granting admin when owner was requested would hand back a different role than
the caller asked for. An owner inviting an owner is not escalation and stays
allowed.

Invite creation, acceptance and revocation each write an audit row
(`organisation.invite_create`, `organisation.invite_accept`,
`organisation.invite_revoke`) carrying the actor, the invitee email and the
granted role. Creation writes the invite and its audit row in one transaction;
a delivery failure withdraws the invite, records an
`organisation.invite_revoke` row with `reason: 'delivery_failed'`, and
deliberately leaves the `invite_create` row, because the grant was recorded and
non-delivery is operational rather than a permission change. Acceptance writes
its row in the same transaction as the move, so the role change and the grant
record commit together.

The clamp is not only forward-looking. Migration
`0023_revoke_admin_granted_owner_invites.sql` revokes, at deploy, every open
owner invite whose creator does not currently hold owner, so a pre-existing
admin-granted owner invite cannot complete the escalation before it expires.

Deferred product question — last-owner removal (reported, not changed):
`DELETE /api/organisations/:organisationId/members/:userId` requires an owner
and refuses only when the target is the last owner, so a second owner can
remove the first and can then remove every other owner. That is defensible for
offboarding and unavoidable for a two-owner firm, but it gives one compromised
owner the whole tenant, and removal should arguably need a different owner's
assent rather than any single owner's. That is a product decision and is not
implemented here. The removal transaction now locks the organisation's owner
rows with `order by id` before it reads and counts them, so the count and the
removal are one serial decision and two simultaneous removals of the last two
owners can no longer both commit. Locking the owner rows rather than the
`organisations` row is deliberate: the invite-accept path updates `users` and
only then deletes the vacated organisation, so taking an organisation-row lock
before the user locks here would invert that order and deadlock against
accept. A concurrent invite acceptance can only add an owner and never locks
the existing owner rows, so it cannot create an ownerless organisation. That
matters because the clamp in this change is what made the race unrecoverable
through the API: before it an ownerless organisation could be recovered by an
admin minting an owner invite, and after it only an owner can grant owner.
One concrete gap in the surrounding guard remains and is recorded so it is not
lost: member removal writes no audit row at all, so an owner eviction is
currently invisible in the audit log — the highest-value low-risk follow-up.
It is reported, not fixed, to keep this change to the escalation decision; the
decision to leave it is explicit rather than silent.

### Account and organisation settings — session-scoped mutations, retained drafts (15 September 2026)

Context: Settings rendered a read-only profile (name, email, role) and an
owner-only organisation rename. There was no way to change the account name and
no password-change UI at all, although `emailAndPassword` mounts
`POST /api/auth/change-password`. Considered a `PATCH /api/users/:userId` route,
a client-side draft stash, and a route-change blocker for unsaved edits.

Decision: account mutations are scoped by the session, not by a request field.
`PATCH /api/me` carries no user id in the path or body, so "update the wrong
account" is not a reachable state rather than a validation to remember; the
Settings client calls the bare `PATCH /api/organisations` for the same reason,
leaving the addressed path as the only route that has to prove ownership.
`packages/contracts/src/account.ts` owns the name rule and the password length
policy, and `services/api/src/auth.ts` configures better-auth from those same
constants, so a form cannot state a rule the API does not apply.
`displayNameField` in `organisation.ts` is the one name rule behind both the
account and the organisation name, including the format-character strip.

Password change reuses better-auth's endpoint unchanged: the API does not read
the request body, and a successful change is audited at the auth boundary as
`auth.password_changed` with the actor and no credential material. Other
sessions are revoked, matching `revokeSessionsOnPasswordReset`. Email change is
not implemented: no verified-email-change flow exists, and a mutation without
verification, session handling and collision protection would be worse than the
read-only field it replaces.

The password-change audit is deliberately non-fatal, and the boundary is real
rather than atomic. better-auth changes the password, revokes the other sessions
and mints the replacement session inside its own handler, committing each write
through the pool before it produces the 200 the route returns; the audit insert
is a later, separate statement and there is no shared transaction to join. A
failed append therefore cannot roll the change back, so it must not rewrite a
completed credential mutation as a failure. `appendPasswordChangedAudit`
(`services/api/src/auth-change-audit.ts`) appends when it can and, when it
cannot, reports a structured error carrying identifiers only — action, user id,
organisation id, request id, message — with the request body never read and
`metadata_json` left empty. Rejections are still audited never: the branch is
gated on the handler's own success response, so a wrong current password cannot
mint an event.

Name-form state: the account and organisation name fields share one policy,
`useCanonicalNameField` (`packages/app-shell/src/views/use-canonical-name-field.ts`).
It owns the draft, the saved baseline and the mutation result together, so a
resolved save cannot discard text typed while the request was in flight, a
refetched or cross-tab canonical value advances a clean field and is preserved
as Reset's baseline when the field is dirty, a stale response cannot regress a
later canonical value, and a failure keeps both the draft and the previous
baseline. The canonical value is the mounted query cache's, not the input's.
Reconciliation runs during render against the stored previous prop rather than
in an effect, which is what keeps the field from painting a stale value first.
The identity (user id, organisation id) is part of the model, so switching
account or organisation discards the draft instead of carrying it into another
record's form.

Draft retention: every Settings section stays mounted and is hidden when
inactive, so a half-typed change survives moving between sections. The
alternative — a stash or a navigation blocker — would either duplicate the form
state or add a mechanism the repository does not have elsewhere.

Outcome: no migration. `users.name` already exists; no new personal-data field,
retention behaviour, route namespace or dependency was added, so
`docs/data-and-compliance.md` is unchanged. Omitted deliberately: notification
and theme preferences (the shell's own control owns the theme, and there is no
notification system to own), email change, and any session list beyond the
revocation the password change performs.

Structural note (same change): the account write path, `updateUserName`, lives
in `services/api/src/account-database.ts` rather than in `database.ts`, which is
far past the 500-line ceiling, and the non-fatal password audit lives in
`services/api/src/auth-change-audit.ts` for the same reason. The Settings,
app-shell auth and API route tests are split into focused suites:
`views/settings-{navigation,account,security,organisation}.test.tsx`,
`views/settings-name-policy.test.tsx`,
`views/use-canonical-name-field.test.tsx`, `views/settings-test-support.tsx`,
`auth-change-password.test.tsx`, `account-routes.test.ts`, `auth-audit.test.ts`,
`auth-password.db.test.ts`, `password-policy.test.ts` and
`app-test-support.ts`. `services/api/src/database.ts` (1531 lines) and
`services/api/src/app.test.ts` (3759 lines) remain above the ceiling: both are
pre-existing modules covering many unrelated concerns, and splitting them is a
separate, behaviour-preserving change rather than part of this one.

### Legal-corpus reads get their own database seam (18 September 2026)

Findings: five active development databases (`obiter` plus the four lane databases) each hold a byte-identical copy of the legal corpus. The corpus is 99.2% of every one of them — 1,980,448,768 bytes of roughly 1,997,000,000 — so the duplication is about 7.9 GB on a 75 GB filesystem. Consolidating it was blocked by structure rather than by policy: every corpus read and write went through the same pool as matter, auth and audit work, so there was no seam at which a corpus held elsewhere could be introduced. The trace also found no foreign key and no SQL statement that references both a corpus table and a matter table, and the only code path that touches both is `verification-execution.ts`, which reads the corpus before it opens its matter transaction. The boundary was already there in practice; it had no expression in the code.

Decision: give corpus access its own path. `DatabasePools` (`services/api/src/database-pools.ts`) is the single owner of the process's pools and exposes `corpus` as `{ pool, readOnly }`. `CORPUS_DATABASE_URL` unset means no separate corpus target: the corpus pool _is_ the application pool, there is one pool to close, and behaviour is identical to before the seam existed. Configuring it declares a separate corpus target and is always served read-only, because a process with no corpus write credential has no write path. The mode follows configuration provenance rather than a comparison of connection strings, so a URL that spells the application database differently (a host alias, an omitted port, the same host and database under another role) is still a distinct, read-only target rather than a writable one inferred from a name match. Corpus writes are handed to the route factory as a separate value (`options.corpusWrites`), so a read-only process is never given one to attempt, and no route has to swallow a permission error to stay correct.

The seam also narrows the withdrawal/indexing race. Corpus upserts now return whether the post-merge row may be indexed, read by the same statement that wrote it, so a withdrawal that serialises with a hydration write is respected in either order. That orders the database rows but cannot order two independent Meilisearch operations: a withdrawal whose index delete lands after the upsert but before the hydration index write would re-add the document. `indexFetchedAuthoritiesAfterWrite` therefore re-reads the record after indexing and deletes the document again when it is now withdrawn. The withdrawal marks the row before it deletes the index copy, so a re-read that sees the flag proves that delete preceded the index write. A failed re-read or re-delete is logged, not treated as a confirmed live row.

Outcome: no migration, no new dependency, no deployed resource. Under `NODE_ENV=test` the corpus is required to resolve to the same `*_test` database, and a corpus URL resolving anywhere else refuses startup, because several database-backed suites seed and delete corpora rows. `/api/health` reports `corpus.colocated` and `corpus.readOnly`: booleans derived from configuration, with no host, port, database name or credential. Deliberately not done here: no shared corpus database, no reader role, no credential, no migration move, no index rebuild and no disk reclaimed. Each of those is a separate, separately authorised change.

Corpus writers are not all under `services/api`. Postgres writers: `services/legal-ingestor` (`bulk-ingest` writes `legal_source_documents`, `legislation-ingest` writes `legislation_documents` and `legislation_provisions`, `withdrawal-check` marks `provider_json.withdrawn`) through its own `DATABASE_URL`. The corpus-only API writes no corpus row on a request path: its former provider-hydration writer (`services/api/src/routes/legal-search/moj-client.ts`, now `stored-document.ts` for reads only) was unbound from the request path. Meilisearch-only writers and rebuilders: `rebuild-search-index.ts` and `rebuild-legislation-index.ts` derive the product indexes from Postgres and never write Postgres; the API makes no index write on a request path, and its former hydration indexer is retained unbound. Corpus readers: the proxy, search and verification read paths, `check-search-parity.ts` (read-only, it reports drift and never writes), and the `scripts/search-corpus-relevance` and `scripts/legislation-relevance` harnesses, which re-check expectations against Postgres without mutating it. `rebuild-search-index.ts`, `rebuild-legislation-index.ts` and `check-search-parity.ts` already take an explicit `--database-url`, so an operator points them at whichever database holds the corpus rather than the runtime seam reaching into a CLI. At cutover the shared corpus would have one privileged writer, the ingestor pointed at it explicitly, while every lane process is read-only through the seam; that deployment does not exist and this change does not create it.

### A dedicated corpus writer seam, and the missing legislation constraint (20 September 2026)

Findings: the corpus seam above is read-only by construction, which is right for lanes and insufficient for `obiter-live`. That process keeps fetch-through provider hydration, so it must persist a newly fetched judgment into the shared corpus and index it. With only `CORPUS_DATABASE_URL` configured it can answer a live request but cannot store the result, and `liveResultsNotPersisted` is the truthful diagnostic. The selected shared-corpus architecture had no compatible implementation until the runtime could hold a reader connection and a writer connection at once. Separately, `packages/database/migrations/0020_legislation_documents.sql` declares `legislation_documents_act_type_check` inside `create table if not exists`, so the long-lived live table, which pre-existed 0020, never received it. All 259 current rows satisfy `act_type = 'ukpga'`, so the constraint rejects nothing today, but without it a future non-ukpga ingest would be accepted where the schema intends rejection.

Decision: make the corpus writer a separately configured capability rather than a mode the reader implies. `CORPUS_WRITE_DATABASE_URL` is optional, parsed and validated at the environment boundary, and refused unless `CORPUS_DATABASE_URL` is also set, so reads and writes cannot silently target unrelated databases. `DatabasePools` now exposes `corpus.read` and `corpus.write`; `corpus.write` is null when the process has no writer, and `app.ts` hands the write store over only when it is non-null. The compatibility default is unchanged: neither variable set means one application pool serves reads and writes. An explicitly configured reader is still separate even when it names the same database, and an explicitly configured reader and writer are always distinct pools even when their URLs are identical, because a different role is a different access boundary that URL equality cannot see. Empty and whitespace values never enable the writer, and under `NODE_ENV=test` both variables must resolve to `TEST_DATABASE_URL`. The two are expected to name the same shared corpus, because the writer path reconciles withdrawals by re-reading through the reader. The writer credential is a capability rather than a hostname: the product cannot detect which host is `obiter-live`, so deployment must provide the variable only there and must keep it out of `obiter-live/.env`, which lane setup copies into every lane. This change adds no deployment machinery; it makes the boundary explicit, and the tests prove that absence of the variable disables writes. `/api/health` still reports `corpus.colocated` and `corpus.readOnly`; the pair distinguishes the compatibility seam, a read-only lane and a process with a dedicated writer without disclosing a host, port, database name, username or credential.

The second change is a migration. `0025_legislation_act_type_check.sql` adds `legislation_documents_act_type_check check (act_type = 'ukpga')` as `not valid` and then validates it, guarded so a fresh install where 0020 created the constraint inline is a no-op. Adding it `not valid` avoids a full table scan under the lock; the following validation scans once and proves every existing row, failing the migration loudly if any does not.

Outcome: no shared corpus database, role, credential or index was created, no lane or live configuration was changed, and the cutover remains a later, separately authorised operation. The legal ingestor keeps its own explicit writer connection through its `DATABASE_URL`; `CORPUS_WRITE_DATABASE_URL` is the API runtime's writer and is never handed to a lane.

### Document-model loading moves off the serving event loop (23 September 2026)

Findings: a CPU profile of a verification run against the confirmed `search_unavailable` reproduction named the synchronous operation behind the multi-second event-loop stalls. `getDocumentModel` inflates, XML-parses and validates the whole OOXML package inline on the serving loop whenever a version's `model.json` is not yet cached: stage timings put 3.5 to 4.9 seconds of one medium document's load inside that call under Node, each stall pegging one core, each overlapping exactly one `verification_run` write. Meilisearch answered every proxied query in under 100 ms, but the 2000 ms stored-search timer cannot fire while the loop is blocked, so at stall end the overdue timer beat the already-answered response and served `503 search_unavailable`. Under Bun the same load stalls 1.5 to 1.7 seconds, below the deadline, which made the failure look runtime-specific while the blockage was not: health, search and every other route stalled with it in both runtimes.

Decision: move the synchronous half of `getDocumentModel` onto a bounded pool of document-model worker threads (`document-model-pool.ts`, `document-model-worker.ts`) and keep storage reads and writes, authorisation, database work, findings, audit and failure reporting on the serving loop exactly as before. The pool runs at most two workers and, instead of an unbounded queue, a bounded waiting list: a caller whose workers are all busy parks in a FIFO of at most sixteen waiters, each holding only the payload its own in-flight request already read, and a caller beyond that bound is rejected at once, since an abandoned request's parked task is never cancelled. Each dispatched task has a ten-minute deadline, calibrated against the measured legitimate parse path with roughly three times the slowest observed legitimate load as headroom; a worker that never answers is terminated, its caller settles once, and the slot is replaced on the next dispatch. A second worker spawns only under real contention, and a synchronous `new Worker` failure is contained inside the pool, settling one waiting caller rather than the process. A worker that fails is dropped with its task rejected and replaced on the next dispatch; every failure surfaces as the existing curated `DocumentModelStoreError`, so run failure codes, audit rows and responses are unchanged. Both entry points terminate the pool inside their existing graceful drain. The task protocol is internal to `services/api`; no route, contract, migration, job semantic or deployment shape changed.

Outcome: no API contract change, no migration, no new dependency, no queue system. Before the change, search-during-verification reproduction windows on the task-owned harness produced 6 to 9 `search_unavailable` responses per 60-second Node window with 3.5 to 4.7 second probe-measured stalls and health-canary p99 above 4 seconds, identically under the development watcher and the production launch (`node --import tsx`, `NODE_ENV=production`). After it, the same windows produce zero 503s, zero probe gaps above 500 ms (max 178 to 204 ms) and a health-canary p99 under 80 ms on both runtimes, with the main thread's profile showing 0.01 s of OOXML work against the worker's 11.4 s, and verification results byte-identical across runtimes and before/after (one canonical findings hash for all four probes). Peak resident memory under the workload rises by about 200 MB on Node (one to two worker isolates plus in-flight payload copies), bounded by the pool size; Bun is unchanged. Deliberately not done here: quote-fidelity preparation and the legislation title fold still run on the loop under their existing bounds, `document-presence.ts:126` still parses the package inline on every presence write and is a separate follow-up, `storedSearchTimeoutMs` stays at 2000 ms, the stall-aware timeout option was not taken because it would leave every other route blocked, worker `resourceLimits` are not set because Bun does not enforce them (so Node alone would gain a containment Bun lacks, and even on Node the limit does not cap native or ArrayBuffer growth), and the parser's pre-existing per-paragraph full-document scans, which make parse time quadratic in paragraph count, are a separate performance follow-up.

### The public changelog bounds its GitHub traffic (27 September 2026)

Findings: `GET /api/changelog` is anonymous, and every request called GitHub's
releases endpoint and, on an empty or failed release result, its commits
endpoint. There was no cache, no coalescing and no deadline, so repeated
anonymous requests amplified traffic against a third party, an upstream stall
was transferred to API request capacity, and a GitHub outage or rate limit
produced one attempt per incoming request. Confirmed by source and by the
change's fail-first tests.

Decision: bound the route at the module that owns it. One application-owned
cache slot holds the last validated body (the resource is fixed, so there is
no key space to evict); concurrent cold or expired callers share one refresh;
a failure sets a two-minute cooldown; a throttle sets a cooldown of at least a
minute, extended by any longer valid `Retry-After` or `x-ratelimit-reset`
value and capped at a day so a malformed or hostile header can neither retry
immediately, overflow the clock nor park refreshes indefinitely; and each
upstream request is aborted after five seconds, which also aborts the response
body. Independently of those intervals, one rolling per-process budget allows
at most thirty upstream HTTP requests in any hour, spent before each request so
successes, failures, the commits fallback and throttled refreshes all draw on
it. A refresh costs one request when releases is non-empty and two when the
commits fallback runs, and the initial cold refresh counts like any other. A
single upstream body is rejected unparsed past a 64 KiB cap, entry arrays past
five entries, and fields past their documented size, and `html_url` is accepted
only as an `https://github.com` link because it is rendered as an anchor href.
A successful result is served for at most twenty-four hours after a failure,
inclusively: at exactly the cap the cached body is still returned, and one
millisecond later the route answers `503` with `github_unavailable`. A stale
body inside the window is byte-identical to a fresh one, including its
`source`, so consumers cannot distinguish them; that is the policy, not an
oversight. Upstream bodies are validated against the expected shape before
caching, so a malformed response cannot replace a good one. The releases-first,
commits-fallback order and both response shapes are unchanged; only the
`source` values already in use are returned.

Outcome: no dependency, credential, shared cache, background poller or
deployment change. The ceiling is thirty requests per rolling hour per API
process, half of GitHub's 60-requests-per-hour unauthenticated allowance, which
leaves headroom for the initial burst and for other callers. It is per process,
so N replicas multiply it N times, and it does not account for any other client
sharing the same egress IP; together those can still exhaust the shared
unauthenticated allowance. In the healthy paths the route makes about six
requests an hour when releases succeeds and about twelve when the commits
fallback is used; under sustained failure, throttle or fallback the budget
still holds at thirty. Deliberately not done here: the route is not
rate-limited per caller, because the resource is fixed and the cache makes
per-caller limiting unnecessary, and no staleness marker is added because the
response contract is unchanged. No logging was added, so no request or
upstream data can leak into a log line.

### Matter-share grantees are organisation-scoped by the database (28 September 2026)

Findings: 0013 scoped the matter side of `matter_shares` with a composite
foreign key `(matter_id, organisation_id)` but tied `grantee_user_id` to
`users(id)` alone. `grantMatterShare`
(`services/api/src/routes/document-access.ts`) checks the grantee's organisation
before inserting, so the invariant held on the route path, but the schema did
not require it. That is defect pattern P3, a contract enforced on one path and
not its sibling, and it is why the step-4 experiment on PR #137 was able to
return organisation B's matter once an organisation predicate was dropped: the
seeded share was honoured on access level alone.

Decision: add `0027_matter_share_grantee_organisation.sql`. It adds the
`users (id, "organisationId")` unique index a composite reference needs,
replaces `matter_shares_grantee_fk` with
`matter_shares_grantee_organisation_fk foreign key (grantee_user_id,
organisation_id) references users (id, "organisationId") on delete cascade`,
and keeps the application check as the first line of defence. Cascade is
preserved, so deleting a user still removes their shares. `created_by` keeps its
`users(id)` reference: it records who granted the share (historical
authorship), not current membership, so the recipient's rule is deliberately not
applied to it.

The migration fails closed on pre-existing rows whose grantee is outside the
share organisation. It raises a `foreign_key_violation`, names the offending
shares and the audited revocation path, and rolls the whole file back rather
than deleting or rewriting rows to make validation pass. The unique index is a
plain `create unique index` and the constraint a plain `alter table`, so both
run inside the migration runner's per-file transaction; that takes an `ACCESS
EXCLUSIVE` lock on `users` and `matter_shares` and validates the new key with a
full scan of `matter_shares`. That is acceptable at the current table size and
is why `create index concurrently` is not used.

Membership: a member removal (`DELETE
/api/organisations/:organisationId/members/:userId`) now revokes the removed
member's shares for that organisation in the same transaction, writing one
`matter.share_revoke` audit row per share with the same metadata the
share-revocation route writes, before the `organisationId` change the composite
key would otherwise reject. Invite acceptance needs no revocation:
`organisationHasBlockingWork` refuses to move a user out of an organisation
that holds any matter row, so the vacated organisation cannot hold a share that
names them. An organisation change is never cascaded into moving shares between
organisations.

Ordering: `0027` is independent of every other pending file. A fresh install
applies it in filename order and an upgrade applies it whenever it becomes
pending, so it is safe whichever of two concurrently proposed migrations lands
first. The route-level sharing and access contracts are unchanged; the
constraint is a backstop, not a replacement for the application checks.
