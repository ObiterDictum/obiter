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

A malformed cursor or an out-of-range limit is a `400 validation_failed`, never
an unbounded query.

`GET /api/verification-runs/:runId/report`

- V6. Not in this slice.
