# Verify API

`POST /api/documents/:documentId/verification-runs`

- body `{ versionId }` (required). Edit-gated. Starts or returns the live run
  bound to that immutable version.

`GET /api/documents/:documentId/verification-runs`

- View-gated list for one document.

`GET /api/verification-runs`

- View-gated organisation list.

`GET /api/verification-runs/:runId`

- Run summary, including a `stale` flag when the document's current version is
  no longer the bound version.

`GET /api/verification-runs/:runId/findings`

- Structured findings with evidence identities.

`GET /api/verification-runs/:runId/report`

- V6. Not in this slice.
