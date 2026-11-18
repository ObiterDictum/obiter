# Redact Implementation

## Scope

- text extraction for supported file types
- sensitive span detection
- reviewer decisions
- pseudonymised output
- irreversible redacted output
- audit log generation

## Build Steps

1. implement extraction for first supported file types
2. integrate Python redaction worker
3. persist detected spans
4. build review UI
5. implement output generation and audit logs

## Stack

- Node.js
- TypeScript
- Python for `services/redact-worker`
- BullMQ
- PostgreSQL

## Safety Rules

- no fully automated signoff for high-risk outputs
- export must remove recoverable text, not merely hide it

## Secure PDF output

Hard redaction (`POST /api/redaction-runs/:runId/finalize` with `outputMode:
redacted`) always produces one image-only PDF. A DOCX source is sanitized with
`buildRedactedDocx`, rendered to an intermediate PDF by the sandboxed renderer worker
configured by `OBITER_REDACTION_RENDERER_URL`, then rasterized. A PDF source is
rasterized with bars burned in. A text source is paginated into page images. The
result passes a validation gate (valid PDF, no selectable text layer, no fonts,
annotations, forms, attachments or source strings, page and size limits) before it is
stored, and the run is only marked `finalized` after persistence. A failure leaves
the run unfinalized, keeps no output and reports `redaction_secure_pdf_failed`.

## On-device detection engine

`@obiter/rampart-inference` keeps the heuristic layer free of the model: the
transformers.js pipeline is imported on first use inside `loadNerClassifier`, so
importing the package and running `detectHeuristics` never loads the runtime.

`detectNer` sizes windows by the classifier's own tokenizer, never by a character
count, and always makes forward progress. Input that fits one window, or any
classifier with no tokenizer, takes a single-window path whose result is identical
to scanning the text directly; the path exists only to avoid window planning.

Span repair is bounded: it stops after 32 convergence iterations so rows full of
same-label fragments cannot loop between rescue and bridging. Healthy text converges
in a handful.

## Finalise gate (approved divergence)

Redact PRD 2 allowed finalising with unreviewed spans after a warning. The review
screen instead blocks Finalise while any detected span has no decision and
requires an "I have reviewed every page" confirmation, because an undecided span
is not a span somebody chose to keep. The product owner approved keeping both
gates on 2026-10-28; the API still allows the call, so this is a UI rule, not an
API rule. The confirmation itself is not stored.

## Repeated text

Identical text can appear many times in one run. A decision can be repeated on
every detected occurrence (`applyToSameText`). DOCX output changes only accepted
source coordinates; a rejected duplicate or a matching substring in another word
or number stays intact. Other source formats retain the `mixed_text_decisions`
finalisation guard.

## Redaction schedule export

The schedule is served as PDF or DOCX from `GET
/api/redaction-runs/:runId/audit?format=pdf|docx` and is generated server-side.
It lists each decision with its category, reviewer and time, and the audit log,
but never reproduces the removed words: the file is meant to be emailed and
printed. Disclosure copies use generic filenames; schedules identify the run
without reproducing the confidential source filename.

## Shareable audit export

`format=json-shareable` serves the same audit as `obiter.redaction-audit-shareable/v1`,
for handing to the other side. It carries the counts by category and decision,
each decision's category, reviewer, time and page, the reviewer and time of
finalisation, the audit log's actions and actors, and the output's SHA-256. It
carries no span text, no source text and no original filename — the restricted
JSON keeps those for the run's access-controlled record. Pages come from the
same stored layout the review screen reads; a source with no stored layout
leaves the page absent rather than guessing.

## Filing a standalone copy

A run that began from pasted text or a loose upload has no document to return
to. `POST /api/redaction-runs/:runId/save-to-matter` files its finalised copy as
version 1 of a new document in a chosen matter: edit access on that matter is
checked, the stored bytes are re-hashed against the SHA-256 recorded at
finalisation, extraction runs, and the file, version and run are audited.
The copy may be filed into any matter the user can edit. There is no
"redaction matter" and no matter type of its own; a matter does not become
special because a redacted copy was filed in it.
The destination matter and run are locked before filing. The document, version,
run link and audit events commit together; failed writes roll back and remove
staged objects. Concurrent requests resolve to the same saved version, and retries
re-check edit access to the destination matter.

## Provenance mark

A version Redact produced — through Save to matter or Return to document — is
marked wherever it appears: a "Redacted" badge with the line "Produced by Redact
on 29 Oct 2026 by A. Morgan", linking to the run for a reader who may open it.
Text and an icon, never colour alone. The mark appears in the matter's documents
table, the document's version list and version viewer, the editor header (Word,
PDF and text), Home's recent documents, and the matter list's document preview.
It is derived from data the run already records: `returned_document_version_id`
links the run to the version it created, and the run's finalise audit row names
the reviewer. No column was added. A reader who may see the filed copy but not
the standalone run behind it still sees the mark, without the link.

## DOCX coordinate and output ownership

Redact owns DOCX extraction and burning. The same XML walker supplies UTF-16
review offsets and immutable per-carrier source ranges for body text, headers,
footers, notes, comments and tracked text. Paragraphs contribute two newlines;
tabs and breaks contribute one character. Modern alternate content is canonical;
its duplicate fallback is removed. No editor edit operation produces Redact bytes.
Matter ingestion keeps its existing extraction for Search. Migration 0040 lets
matter DOCX runs store Redact's own extracted text under their scoped run key;
re-detection carries that text forward without changing the matter version.

Before burning, the complete stored extraction and accepted slices must match
the source. Legacy runs with different coordinates require a fresh upload/run;
there is no occurrence search or heuristic realignment. The emitted package is
extracted again and compared with the expected coordinate edits. This gate proves
preservation of all unaccepted mapped text, including duplicates.

Selected fields lose their own instructions and selected hyperlinks lose their
targets, including shared references. Accepted identity text is scrubbed from
image descriptions, titles, filenames and comment/revision authors. Document
properties and stale thumbnails are stripped. A residual gate examines unmapped
XML text, attributes, annotations, encoded targets, UTF-8/UTF-16 binary content
and recursively expanded embedded packages. It refuses unsupported residuals;
it never returns uncertain bytes. Verified mapped character data is exempt from
string matching because it may contain deliberately kept occurrences.

The editable pseudonymised DOCX, Return to document, Save to matter, and private
sanitised DOCX passed to hard-PDF rendering use these bytes. Hard renderer input
normalises otherwise omitted tab/hyphen carriers to equivalent Unicode text.
Symbol-font carriers require a PDF upload rather than guessing glyphs; this adds
no font-mapping dependency. Package limits, malformed content, Unicode-splitting
selections and coordinate mismatches refuse. Pseudonymised refusal retains the
visible text fallback and recorded downgrade; hard output stays unfinalised with
no output or substitute. Return and Save transfer the hash-verified final bytes.
