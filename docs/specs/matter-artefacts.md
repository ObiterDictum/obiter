# Matter Artefacts

Status: specified, not built. Sequenced in [roadmap](../roadmap.md) Milestone 1.33.

## Purpose

A matter's artefacts are the materials a lawyer has chosen as relevant to it: the
judgments, legislation and other sources the matter turns on. Today that knowledge lives
in the lawyer's head or in documents. Artefacts make it an explicit, bounded list that
Verify and, later, the Research agent can use as the matter's own context.

## Terminology

"Artefact" means a source attached to a matter by a person. It is never a file Obiter
generates.

The Phase 0 `artifacts` table, `art_` ids and `/artifacts/` storage path name generated
outputs (redaction outputs, reports, extracted text). They are renamed to **outputs**
before artefacts are built, so the two words never coexist in code. See
[Rename](#rename-artifacts-to-outputs).

## Scope

In:

- Attach a judgment from the corpus to a matter.
- Attach legislation from the corpus: a whole Act or instrument, or a single provision.
- Attach an external link (URL) with a title.
- Attach a note: a short free-text item, such as a principle or a point to check.
- Attach an existing document already in the same matter, so it can be marked as
  relevant.
- List, open, annotate (one optional note per artefact) and remove artefacts.

Out:

- Uploading files directly as artefacts. Files stay matter documents; an artefact can
  point at one.
- Copying corpus text into the matter. Corpus artefacts store identity, not content.
- Sharing artefacts across matters or organisations.
- Agent use. The Research milestone consumes artefacts; this spec only guarantees they
  are readable through the API.

## Where it lives

The individual matter page (`/matters/:matterId`), not the Matters list. The matter's
left column currently holds **Documents**. **Artefacts** becomes a second section in that
column, below Documents, with its own count and an Add control.

Ways to add:

| Surface                          | Action                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| Matter page, Artefacts section   | Add: search the corpus, paste a URL, write a note, or pick a matter document |
| Judgment page (`/cases/:caseId`) | "Add to matter": choose a matter                                             |
| Legislation page (`/ln/...`)     | "Add to matter" on the Act and on each provision                             |
| Search results                   | "Add to matter" on each result                                               |
| Verify finding                   | "Add to matter" on a resolved authority                                      |

Opening a corpus artefact goes to the existing judgment or legislation page. Opening a
document artefact goes to the document.

## Data

New table `matter_artefacts`:

| Column                                   | Notes                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `id`                                     | `atf_` prefix (`art_` stays with legacy outputs; see Rename)                |
| `organisation_id`, `matter_id`           | Composite FK to the matter, matching other matter-owned tables              |
| `kind`                                   | `judgment` \| `legislation` \| `link` \| `note` \| `document`               |
| `judgment_document_id`                   | FK to `legal_source_documents.document_id` when `kind = 'judgment'`         |
| `legislation_identity`                   | legislation.gov.uk identity path (as in `/ln/`) when `kind = 'legislation'` |
| `legislation_provision_id`               | Optional provision within that identity                                     |
| `url`                                    | `https` only, when `kind = 'link'`                                          |
| `document_id`                            | FK to a document in the same matter when `kind = 'document'`                |
| `title`                                  | Captured at attach time for corpus and link kinds; required for notes       |
| `note`                                   | Optional lawyer annotation                                                  |
| `created_by`, `created_at`, `deleted_at` | Soft delete, as other matter data                                           |

A check constraint ties each `kind` to exactly its own reference column. A partial unique
index stops the same source being attached twice to one live matter.

Corpus artefacts store identity only. The judgment or provision text is read from the
corpus when opened, so it always reflects the current source.

Contracts live in `packages/contracts` as a discriminated union on `kind`.

## Withdrawn and missing sources

A judgment can be withdrawn (`legal_source_withdrawals`), and a legislation identity can
stop resolving. The artefact is kept and shown as **Source withdrawn** or **Source
unavailable**, with the captured title. It is never silently dropped or hidden. Opening
it explains why the text is not available.

## API

All routes enforce matter access on the server and are audited.

- `GET /api/matters/:matterId/artefacts`: list live artefacts, with resolution status
  for corpus kinds.
- `POST /api/matters/:matterId/artefacts`: attach. Body is the `kind` union. The server
  resolves corpus identities and rejects unknown ones (`artefact_source_not_found`).
  Attaching a duplicate returns the existing artefact.
- `PATCH /api/matters/:matterId/artefacts/:artefactId`: edit `title` (link and note
  only) and `note`.
- `DELETE /api/matters/:matterId/artefacts/:artefactId`: soft delete.

Audit events: `artefact.attach`, `artefact.update`, `artefact.remove`.

## Security and compliance

The sources themselves are public, but _which_ sources a matter relies on reveals case
strategy. Artefacts are therefore client matter data:

- Organisation- and matter-scoped, server-side access checks, never cross-organisation.
- Deleted with the matter and covered by the matter's export and deletion paths.
- Notes are private text: never logged, never sent to the public search index, never
  used for training.
- External links are stored, not fetched. Obiter makes no request to the URL.
- Nothing about an artefact is sent to Find Case Law or legislation.gov.uk.

## Later consumers (not this milestone)

- **Verify** may resolve a citation against the matter's artefacts first and show when
  an authority cited in a draft is, or is not, one of the matter's artefacts.
- **Research** uses the artefact list as the matter's bounded context. Any model call
  that reads artefacts is visible in product state and audit, per
  [data-and-compliance](../data-and-compliance.md).

## Rename: `artifacts` to `outputs`

Done in migration 0034, as its own PR before artefact work starts.

- Table `artifacts` becomes `outputs`. Columns `artifact_type` and `output_artifact_id`
  become `output_type` and `output_id`. Constraints and indexes are renamed to match.
- New ids use `out_`. Existing `art_` ids stay valid; the id check accepts both.
- New storage keys use `/outputs/`. The object-key check accepts the legacy
  `/artifacts/` path for existing rows, so no stored objects move.
- Code identifiers, contracts and docs (`phase-0/schema.md`, `phase-0/api.md`,
  `architecture.html`, `RULES.md`) follow the rename: `outputId`, `outputType`,
  `output_not_found`, and `output` on the finalize response. The redaction audit export
  becomes `obiter.redaction-audit/v2` because its keys changed.
- The derived files of a document version (`text`, `layout.json`, `model.json`) were
  also called artifacts in code; they become "derived" files (`document-derived-store.ts`).
- "Artifact" stays where it is the standard engineering term and not a product concept:
  CI and build artifacts, and synthetic-corpus and benchmark run artifacts.

## Done when

- A lawyer can add each kind from the matter page and from the surfaces in the table
  above, see them listed in the matter's left column, open them, annotate them and
  remove them.
- A withdrawn judgment artefact shows as withdrawn and is still listed.
- A user in another organisation, or without access to the matter, gets `404` on every
  artefact route.
- Deleting the matter removes its artefacts from every list.
- No product concept, code identifier or matter-facing doc uses "artifact".
