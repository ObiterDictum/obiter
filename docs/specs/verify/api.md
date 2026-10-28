# Verify API

`POST /api/documents/:documentId/verification-runs`

- body `{ versionId }` (required). Edit-gated. Starts or returns the live run
  bound to that immutable version. A `running` run whose lease is still live is
  returned unchanged; an expired one is interrupted and replaced, so a version
  can never be wedged by a dead executor.

`GET /api/documents/:documentId/verification-runs`

- View-gated list for one document. Keyset-paginated: `limit` (1-100, default 25) and an opaque `cursor`. Ordered `(created_at desc, id desc)`. Returns
  `{ runs, nextCursor }`.

`GET /api/verification-runs`

- View-gated organisation list. Same pagination contract as the document list.

`GET /api/verification-runs/:runId`

- Run summary, including a `stale` flag when the document's current version is
  no longer the bound version.

`GET /api/verification-runs/:runId/findings`

- Structured findings with evidence identities. Keyset-paginated: `limit`
  (1-200, default 50) and an opaque `cursor`. Returns `{ run, findings,
nextCursor }`.
- Each finding carries `dismissal` (`null`, or `{ reason, dismissedBy,
dismissedAt }`) and each evidence item carries `source` (`url`,
  `canonicalUrl`, `pinpoint`, `anchor`): the stored URL the source is named
  from, and the in-app source page with its paragraph or provision pinpoint.
  A source the store does not hold yields `null`s, never an invented page.
- The run summary separates `flaggedCount`, `reviewRequiredCount`,
  `notCheckedCount` and `dismissedCount`. Dismissed findings are excluded from
  the first three, because the summary reports work still waiting on a person.

`POST /api/verification-runs/:runId/findings/:findingId/dismiss`

- Edit-gated. Body `{ reason? }` (trimmed, at most 2,000 characters). Records
  who dismissed the finding, when and why; a repeat dismissal replaces the
  reason and the time. A finding whose check matched its source is refused with
  `verification_finding_not_dismissable` (409) — the check found nothing to
  decide. An unknown finding is `verification_finding_not_found` (404), and
  another tenant's run is concealed as not found.
- The dismissal never changes the finding's own state or the document.

A malformed cursor or an out-of-range limit is a `400 validation_failed`, never
an unbounded query.

`GET /api/verification-runs/:runId/report`

- V6. Not in this slice.
