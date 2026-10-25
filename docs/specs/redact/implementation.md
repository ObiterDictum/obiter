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
and output. It uses UTF-16 offsets, decodes XML entities, emits a tab for `w:tab`,
a newline for `w:br`/`w:cr`, two newlines per paragraph, and the Unicode characters
for non-breaking hyphens, soft hyphens and supported font symbols. Leading and
trailing whitespace is trimmed; internal whitespace and Unicode are preserved.
Headers precede the body; footers, labelled notes and comments follow it. Deleted
and inserted revision text is reviewable. Shapes use the modern Choice; duplicate
Fallback content is removed. Text-only in-run alternatives are flattened.

The walker replaces Mammoth for DOCX extraction. Stored runs can still export only
when their complete stored text, after edge trimming, equals the source map.
Different legacy coordinates refuse with a request for a fresh run; offsets are
never realigned by searching. Each accepted span must also equal its stored slice.
Only its mapped source characters are burned. Rejected duplicates and substrings
inside other words remain unchanged. Layout separators crossing empty paragraphs
have no source bytes to consume. The marker is emitted once per merged selection;
overlapping pseudonyms use the earliest-starting token, longest first on ties.

`redaction-docx-burn.ts` owns byte replacements, with read-only OOXML parsing and
serialisation shared with the editor. Editor edit operations are forbidden here.
Only the innermost field whose result is selected loses its own instructions;
other TOC entries retain theirs. Selected hyperlinks lose their target relationship
and references, including shared drawing references. Field markers and structure
outside the selection remain. Accepted text is scrubbed from drawing descriptions,
titles and picture filenames throughout the part, and from comment/revision
authors, preserving metadata unrelated to accepted identities.
Marker colour/highlight precede extension properties and property-change history.

Before returning, the emitted package is independently extracted and compared to
the expected offset edits. The residual gate excludes only those verified text
carriers, allowing deliberate rejected duplicates. It examines other decoded XML
text and attributes, percent/entity-decoded targets, UTF-8 and UTF-16LE binary
content, and recursively expanded embedded packages. Font sizes and other typed
formatting values are not prose occurrences. Hidden-text matching respects Unicode
word edges. Nested packages have a shared 72 MiB expansion budget and depth cap 4.
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

Remaining refusals include mismatched legacy extraction, unsupported symbol fonts,
invalid XML/packages, missing required relationships/overlays, Unicode-splitting
selections, hidden residuals in unsupported parts, and nested-package resource
limits. The coverage guard still refuses unreviewed altChunks, chart/DrawingML text
and unknown parts; images require OCR when they are the only content. Comments,
tracked text, supported shapes, breaks, hyphens and empty paragraphs are supported.
