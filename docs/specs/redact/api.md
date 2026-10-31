# Redact API

`POST /api/redaction-runs`

`POST /api/documents/:documentId/redaction-runs`

Creation returns **202** with a `detecting` run after authentication, upload
validation, source storage and transactional run/audit creation. Extraction and
detection run in the API's leased Postgres worker, not the HTTP request. Poll
`GET /api/redaction-runs/:runId`: `detectionProgress` contains `completed` and
`total` sections (zero total while extracting). Completion changes status to
`ready_for_review`; failure changes it to `failed` with a safe
`summary.failureReason`. Failed derived text/layout are removed, while originals
remain for retry under the existing soft-deletion/restore lifecycle. Linked matter
originals are untouched.

`POST /api/redaction-runs/:runId/retry`

Requires edit access and a failed job. Requeues the retained source with a fresh
three-attempt lease budget and returns **202**. Automatic recovery retries expired
90-second leases, renewed every 15 seconds; exhausted recovery marks the run failed.

`GET /api/redaction-runs/:runId`

`GET /api/redaction-runs/:runId/spans`

Spans, source-file preview, document text and layout return **409 redaction_run_not_ready** until
detection completes. Decisions and finalisation retain their reviewable-state
guards. All user-facing reads and retries retain organisation and matter ACLs.

`POST /api/redaction-runs/:runId/spans/:spanId/decision`

`POST /api/redaction-runs/:runId/finalize`

Applies decisions. `outputMode: "redacted"` (hard redaction) produces one immutable,
image-only secure PDF: a PDF source is rasterized with bars burned in, a DOCX source
is sanitized then rendered through the sandboxed worker and rasterized, and a text
source is paginated into page images. The run is finalized only after the PDF is
generated, validated and stored; a failure returns `redaction_secure_pdf_failed` and
leaves the run unfinalized with no output. `outputMode: "pseudonymised"` remains a
separate editable output with consistent category tokens and an audited token map.

`GET /api/redaction-runs/:runId/output`

`GET /api/redaction-runs/:runId/output/file`

`GET /api/redaction-runs/:runId/audit?format=json|json-shareable|pdf|docx`

`json` is the restricted audit record (span text and original filename
included). `json-shareable` is `obiter.redaction-audit-shareable/v1`: counts,
categories, decisions, reviewers, times, pages and the output's SHA-256, with no
span text, source text or original filename. `pdf` and `docx` are the schedule.

`POST /api/redaction-runs/:runId/save-to-matter`

Files a finalised standalone run's copy into any matter the caller may edit.
There is no "redaction matter" concept.

`POST /api/redaction-runs/:runId/return-to-document`

Commits a document-bound run's copy as a new version. Every version Redact
produced carries its run's provenance (`redaction: { runId, producedBy, canOpen }`)
on the document version records the documents API returns.
