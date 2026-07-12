# Redact Milestones

> **Detection scope (verified July 2026):** "Detection" in M1 means the deterministic UK supplement (`packages/redaction-policy/src/supplement.ts`) only — national insurance numbers, case references, organisation names, emails, UK phone numbers, postcodes, GB IBANs, and context-gated sort codes / account numbers. The Rampart token-classification model integration (names, addresses, dates of birth, context-dependent detection) is planned but not shipped. See [Redact PRD 1](../../prds/redact-1-detection.md) for the design and current status.

## M1 — complete

- Detection, UK supplement and storage-backed source text work. "Detection" here is the deterministic UK supplement; the Rampart model integration is outstanding.

## M2 — complete

- Review UI, decisions, redacted output and pseudonymised output work.

## M3 — production readiness

- DOCX/TXT multipart upload extracts server-side text and records a ready or failed document status.
- Versioned audit export is generated on read at `GET /api/redaction-runs/:runId/audit` (JSON, HTML and Markdown). Persisting `redaction_report` artifacts is deferred to a tracked follow-up.
- Synthetic UK legal training data, a reviewed-run JSONL exporter, demo fixture and walkthrough are checked in.
- Fine-tuning preparation is documented in `fine-tuning.md`.

Deferred: PDF extraction/redaction, actual Rampart fine-tuning, desktop-local redaction, batch processing and firm-specific policy configuration.

## Verification references

- Demo walkthrough: `docs/specs/redact/demo.md`
- Demo fixture: `data/evals/redact/demo-fixture.docx`
- Training corpus generator: `scripts/generate-synthetic-data.ts`
