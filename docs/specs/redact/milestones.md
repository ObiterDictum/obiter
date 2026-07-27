# Redact Milestones

> **Detection scope (re-verified 2026-07-27):** this note previously said the Rampart model integration was planned but not shipped. It has since shipped. Detection now runs the Rampart token-classification model (names, addresses, dates of birth, context-dependent detection) merged with the deterministic UK supplement (`packages/redaction-policy/src/supplement.ts`: national insurance numbers, case references, organisation names, emails, UK phone numbers, postcodes, GB IBANs, and context-gated sort codes / account numbers).
>
> When the model cannot be loaded, detection degrades to supplement-only and records `mode=heuristics+supplement`. That degraded state is **not currently surfaced to reviewers**, which is the primary item in [Redact PRD 4](../../prds/redact-4-hardening.md). Design record: [Redact PRD 1](../../prds/archive/redact-1-detection.md).

## M1 — complete

- Detection, UK supplement and storage-backed source text work. "Detection" here is the deterministic UK supplement; the Rampart model integration is outstanding.

## M2 — complete

- Review UI, decisions, redacted output and pseudonymised output work.

## M3 — production readiness

- DOCX, text-layer PDF, and TXT multipart upload extract server-side text and record a ready or failed document status.
- Versioned audit export is generated on read at `GET /api/redaction-runs/:runId/audit` (JSON, HTML and Markdown). Persisting `redaction_report` artifacts is deferred to a tracked follow-up.
- Synthetic UK legal training data, a reviewed-run JSONL exporter, demo fixture and walkthrough are checked in.
- Fine-tuning preparation is documented in `fine-tuning.md`.

Deferred: PDF extraction/redaction, actual Rampart fine-tuning, desktop-local redaction, batch processing and firm-specific policy configuration.

## Verification references

- Demo walkthrough: `docs/specs/redact/demo.md`
- Demo fixture: `data/evals/redact/demo-fixture.docx`
- Training corpus generator: `scripts/generate-synthetic-data.ts`
