# Redact Milestones

## M1 — complete

- Detection, UK supplement and storage-backed source text work.

## M2 — complete

- Review UI, decisions, redacted output and pseudonymised output work.

## M3 — production readiness

- DOCX/TXT multipart upload extracts server-side text and records a ready or failed document status.
- Versioned audit export is available at `GET /api/redaction-runs/:runId/audit` (JSON, HTML and Markdown).
- Synthetic UK legal training data, a reviewed-run JSONL exporter, demo fixture and walkthrough are checked in.
- Fine-tuning preparation is documented in `fine-tuning.md`.

Deferred: PDF extraction/redaction, actual Rampart fine-tuning, desktop-local redaction, batch processing and firm-specific policy configuration.

## Verification references

- Demo walkthrough: `docs/specs/redact/demo.md`
- Demo fixture: `data/evals/redact/demo-fixture.docx`
- Training corpus generator: `scripts/generate-synthetic-data.ts`
