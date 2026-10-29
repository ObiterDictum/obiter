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

## Finalise gate (approved divergence)

Redact PRD 2 allowed finalising with unreviewed spans after a warning. The review
screen instead blocks Finalise while any detected span has no decision and
requires an "I have reviewed every page" confirmation, because an undecided span
is not a span somebody chose to keep. The product owner approved keeping both
gates on 2026-10-28; the API still allows the call, so this is a UI rule, not an
API rule. The confirmation itself is not stored.

## Repeated text

Identical text can appear many times in one run. A decision can be repeated on
every occurrence (`applyToSameText`), and finalising is refused with
`mixed_text_decisions` while the same text is redacted in one place and kept
visible in another: the output would otherwise carry the words the reviewer
decided to remove.

## Redaction schedule export

The schedule is served as PDF or DOCX from `GET
/api/redaction-runs/:runId/audit?format=pdf|docx` and is generated server-side.
It lists each decision with its category, reviewer and time, and the audit log,
but never reproduces the removed words: the file is meant to be emailed and
printed. Disclosure copies use generic filenames; schedules identify the run
without reproducing the confidential source filename.

## Filing a standalone copy

A run that began from pasted text or a loose upload has no document to return
to. `POST /api/redaction-runs/:runId/save-to-matter` files its finalised copy as
version 1 of a new document in a chosen matter: edit access on that matter is
checked, the stored bytes are re-hashed against the SHA-256 recorded at
finalisation, extraction runs, and the file, version and run are audited.
The destination matter and run are locked before filing. The document, version,
run link and audit events commit together; failed writes roll back and remove
staged objects. Concurrent requests resolve to the same saved version, and retries
re-check edit access to the destination matter.
