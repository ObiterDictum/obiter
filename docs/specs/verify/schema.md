# Verify Schema

## Tables

`verification_runs` (migration 0024)

- Bound to `organisation_id`, `matter_id`, `document_id`, and an immutable
  `document_version_id`.
- Status: `queued`, `running`, `completed`, `failed`.
- One **live** row per `(organisation_id, document_id, document_version_id)`,
  where live means `status in ('queued', 'running')`. A partial unique index
  enforces that. Terminal rows leave the index, so run history accumulates and
  a retry after a terminal state is a new run rather than a reuse of partial
  state.
- A live run holds a bounded lease: `lease_expires_at` says when the current
  executor's claim stops being trustworthy, and `lease_token` fences a
  reclaimed executor out of completing over its replacement. The token is
  cleared when the run reaches a terminal state. A `running` row whose lease
  has expired is interrupted (`failure_code = 'interrupted'`, findings
  deleted, lease cleared) and replaced under the same row lock that serialises
  POSTs for the version.
- `tenant_isolation` is enforced by composite FKs plus the partial unique
  index; failure codes carry no matter text.

`verification_findings`

- Primary key `(run_id, finding_id)` so V1 finding ids stay stable on retry.
- Composite FK `(run_id, organisation_id)` enforces tenant isolation.
- `payload_json` is the V1 finding, including citation/quotation text. That
  payload is not copied into audit metadata, logs, or queue identifiers.
- Finding locations carry `storyKind` and `storyPartName` when they come from a
  multi-story extraction, and V1 finding ids include them, so paragraph ids
  that collide across stories cannot collide as findings.
- Indexed by `(organisation_id, run_id, created_at, finding_id)` for keyset
  pagination.

`verification_claims`

Deferred to Verify Advanced (proposition support).
