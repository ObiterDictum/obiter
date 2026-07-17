# Obiter Redact demo

Fixture: `data/evals/redact/demo-fixture.docx`. It is synthetic and is a workflow smoke test, not an accuracy claim.

## Prerequisites

Run the API and web app locally. Register through the sign-up screen, create an organisation from Home, then create a matter. Do not use a seed script.

## Walkthrough

1. Upload `demo-fixture.docx` to the matter document endpoint as multipart field `file`, with `fileType=docx` and a SHA-256 `contentSha256` field. Expect `201` and a `ready` version with `textObjectKey`.
2. Create a run with `POST /api/documents/:documentId/redaction-runs` and `{"policyMode":"internal_ai_minimisation"}`.
3. Open `/redact/:runId`; verify detected spans, including NI number, case reference and contact details.
4. Accept private PII. Reject the public-record names Mr Justice Holroyd and Ms Priya Sharma.
5. Finalize in redacted mode. Confirm `/api/redaction-runs/:runId/output` contains replacements.
6. Download `GET /api/redaction-runs/:runId/audit`; the versioned report contains source reference, summary, decision history, reviewer and output reference. Try `?format=html` and `?format=markdown`.
7. Create a second run and finalize pseudonymised output to demonstrate consistent tokens.

## Known edge-case outcomes

- Overlaps: policy merge retains the higher-priority Rampart span.
- Empty text and zero spans: runs reach `ready_for_review` and can finalize unchanged.
- All spans rejected: output equals source text.
- Detection/extraction failures: the relevant record reaches `failed` with a failure reason; no unhandled error is exposed.
- Text-layer PDF: extracts to text for Redaction; output remains text, not a redacted PDF. Scanned/image-only PDFs require OCR, so standalone runs are rejected and matter versions fail extraction.

The fixture metadata is `demo-fixture-expected-spans.json`.
