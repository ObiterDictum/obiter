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

`services/api/src/redaction-docx-burn.ts` owns the bytes consumed by pseudonymised
DOCX output and the hard-redaction renderer. It uses read-only OOXML anchors and
XML utilities, never editor edit operations or range-edit splitting. Any redaction
inside a field clears its instructions, even instructions outside the text span,
so a hidden target cannot disclose the redacted identity or regenerate the result.
Field markers and surrounding tabs, breaks and footnote references remain intact.
A redacted hyperlink loses its target relationship and every reference to that
relationship in the story, including shared references; other display text stays.
The whole-package residual-span gate is awaited as the last step before returning.
