# Redact API

`POST /api/documents/:documentId/redaction-runs`

`GET /api/redaction-runs/:runId`

`GET /api/redaction-runs/:runId/spans`

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
