# Verify Schema

## Tables

`verification_runs` (migration 0024)

- Bound to `organisation_id`, `matter_id`, `document_id`, and an immutable
  `document_version_id`.
- Status: `queued`, `running`, `completed`, `failed`.
- One live row per `(organisation_id, document_id, document_version_id)`.
- Failure codes carry no matter text.

`verification_findings`

- Primary key `(run_id, finding_id)` so V1 finding ids stay stable on retry.
- Composite FK `(run_id, organisation_id)` enforces tenant isolation.
- `payload_json` is the V1 finding, including citation/quotation text. That
  payload is not copied into audit metadata, logs, or queue identifiers.

`verification_claims`

Deferred to Verify Advanced (proposition support).
