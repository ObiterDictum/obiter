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

## DOCX output ownership

`redaction-docx-map.ts` is the common extractor and source map for DOCX review
and output. It uses UTF-16 offsets, decodes XML entities, emits a tab for a run
`w:tab` (never a paragraph tab-stop definition), a newline for `w:br`/`w:cr`, two newlines per paragraph, and the Unicode characters
for non-breaking hyphens, soft hyphens and supported font symbols. An unsupported
symbol becomes U+FFFD, so it stays reviewable and burnable. Leading and
trailing whitespace is trimmed; internal whitespace and Unicode are preserved.
Headers precede the body; footers, labelled notes and comments follow it. Deleted
and inserted revision text is reviewable. Shapes use the modern Choice; duplicate
Fallback content is removed. Text-only in-run alternatives are flattened.

The walker supplies Redact's DOCX extraction only; matter uploads keep Mammoth.
A run on a matter DOCX extracts the version's original bytes with the walker and
stores that text under the run (`redaction-runs/<id>/source`, allowed for matter
runs by migration 0035); the matter version's stored text is unchanged and is
never a DOCX run's source. A package in which the walker finds no reviewable text
refuses run creation rather than storing coordinates the burn cannot use. Stored runs can still export only
when their complete stored text, after edge trimming, equals the source map.
Different legacy coordinates refuse with a request for a fresh run; offsets are
never realigned by searching. Each accepted span must also equal its stored slice.
Only mapped source characters are burned. Explicitly rejected offsets and
substrings inside other words remain unchanged. Layout separators crossing empty paragraphs
have no source bytes to consume. The marker is emitted once per merged selection;
overlapping pseudonyms use the earliest-starting token, longest first on ties.

`redaction-docx-burn.ts` owns byte replacements, with read-only OOXML parsing and
serialisation shared with the editor. Editor edit operations are forbidden here.
Every field whose result encloses burned text loses its instructions, except a
TOC container whose own instruction holds no accepted text; other TOC entries
retain theirs. Selected hyperlinks lose their target relationship
and references, including shared drawing references. Field markers and structure
outside the selection remain. Accepted text is scrubbed from drawing descriptions,
titles and picture filenames throughout the part, and from comment/revision
authors, whose initials on the same element are then burned too, preserving
metadata unrelated to accepted identities.
Marker colour/highlight precede extension properties and property-change history.

Before returning, the emitted package is independently extracted and compared to
the expected offset edits. The residual gate excludes only those verified text
carriers, allowing deliberate rejected duplicates. It examines other decoded XML
text and attributes, percent/entity-decoded targets, UTF-8 and UTF-16LE binary
content, and recursively expanded embedded packages. Any part whose content is
XML is decoded (by BOM, UTF-16 shape or declared encoding) whatever its name;
undecodable `.xml`/`.rels` parts refuse, and parts with other names keep the
raw UTF-8/UTF-16 byte check too. Font sizes and other typed formatting values
and font names (theme typefaces, `w:rFonts`, font table entries) are not prose
occurrences. Hidden-text matching is a plain substring match, fail-closed for
identifiers, link targets and custom XML; the one exception is that a number is
not matched inside a longer number (accepted `24` in a `2024` date). Nested packages have a shared 72 MiB expansion budget and depth cap 4.
A matching embedded object refuses with its part path; binaries are never edited.

Hard redaction renders only this verified DOCX and refuses on burn failure.
Its private render input converts untouched tab, carriage-return, hyphen and symbol
carriers to equivalent Unicode text, because the renderer model omits those OOXML
nodes. The emitted-text proof still requires identical characters. Editable
pseudonymised output keeps the original carriers. Embedded
objects are retained and checked before rendering: removing one could change
unaccepted visible content. Pseudonymised output instead uses the documented visible
`text/plain` fallback when DOCX burning fails, persisting and returning an
`outputDowngrade` reason. It contains no original container or embedded objects.
Span-integrity errors remain conflicts rather than downgrade opportunities.

Remaining refusals include mismatched legacy extraction (a distinct 409 or
`legacy_coordinates` downgrade telling the user to create a fresh run), invalid XML/packages, missing required relationships/overlays, Unicode-splitting
selections, hidden residuals in unsupported parts, and nested-package resource
limits. The coverage guard still refuses unreviewed altChunks, chart/DrawingML text
and unknown parts; images require OCR when they are the only content. Comments,
tracked text, supported shapes, breaks, hyphens and empty paragraphs are supported.
The guard treats notes, revisions, comments and textboxes as reviewed only when
the run's text equals the walker's map, and runs the walker only when the
original checks would refuse; legacy runs keep those checks unchanged.

### DOCX review coordinates

Standalone Redact uses its own UTF-16 text walker; matter ingestion, Search,
Verify and the document editor retain their existing extraction behaviour.
Deleted/moved-from text is reviewable between `[Deleted text]` and
`[End deleted text]` labels with paragraph separators. Comment bodies are
reviewable in labelled trailing regions. Editable output preserves unaccepted
review content; the pseudonymised text fallback uses only this reviewed text.

Accepting DOCX text burns its other exact, word-bounded occurrences throughout
the mapped stories, including detector-missed headers and comments. An explicitly
rejected/kept span keeps every occurrence inside it: rejecting `Alice Smith`
keeps its `Smith` even when `Smith` is accepted elsewhere. Additional burns and
occurrences kept this way are counted in the persisted summary and finalize
audit; additional burns are shown in the finalized output. The same expansion applies to the reviewed text fallback.
Hidden copies outside mapped stories still refuse output when they cannot be
safely burned.

Burning a nested field result clears all enclosing result-field instructions.
A TOC container is the exception: its instruction stays unless the instruction
itself contains accepted text. Burned entry fields are cleared; sibling entry
instructions stay, so updating unrelated entries cannot restore the burned text.
