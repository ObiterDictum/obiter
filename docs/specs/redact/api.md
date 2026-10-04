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
leaves the run unfinalized with no artifact. `outputMode: "pseudonymised"` remains a
separate editable output with consistent category tokens and an audited token map.

`GET /api/redaction-runs/:runId/output`

`GET /api/redaction-runs/:runId/output/file`
