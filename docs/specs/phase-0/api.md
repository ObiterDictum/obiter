# Phase 0 API

## Purpose

This document defines the Phase 0 API surface for auth, matters, documents, jobs, artifacts, and audit-backed activity.

The API should be implemented once and used by both web and Electron. Electron may add native helpers for file picking, cache, and local queueing, but it must not fork the product API model.

## Conventions

- JSON is the default request and response format.
- IDs are opaque strings.
- Timestamps are ISO 8601 UTC strings.
- API field names use `camelCase`.
- Database fields may use `snake_case`.
- Mutating endpoints require an authenticated session.
- All organisation-scoped reads and writes must be filtered by the authenticated user's organisation.
- Responses that list records should support pagination before the list can grow without bounds.
- Failure responses should use a stable shape:

```json
{
  "error": {
    "code": "matter_not_found",
    "message": "Matter was not found.",
    "requestId": "req_..."
  }
}
```

## Error Codes

Minimum Phase 0 codes:

- `unauthenticated`
- `forbidden`
- `validation_failed`
- `matter_not_found`
- `document_not_found`
- `document_version_not_found`
- `artifact_not_found`
- `upload_failed`
- `storage_unavailable`
- `job_unavailable`
- `conflict_detected`

Legal-critical flows must not hide errors behind generic success responses.

## Auth

`/api/auth/*`

Handled by `better-auth`. The app must also expose an organisation-aware current-user view:

`GET /api/me`

Response:

```json
{
  "user": {
    "id": "usr_...",
    "email": "user@example.com",
    "name": "User Name",
    "role": "owner"
  },
  "organisation": {
    "id": "org_...",
    "name": "Example Chambers",
    "plan": "private_beta"
  }
}
```

## Matters

`POST /api/matters`

Request:

```json
{
  "name": "ABC v DEF",
  "clientReference": "REF-001",
  "primaryJurisdiction": "england_and_wales",
  "secondaryJurisdictions": [],
  "legalDomains": ["civil_litigation"]
}
```

Response: `201 Created`

```json
{
  "matter": {
    "id": "mat_...",
    "name": "ABC v DEF",
    "clientReference": "REF-001",
    "primaryJurisdiction": "england_and_wales",
    "secondaryJurisdictions": [],
    "legalDomains": ["civil_litigation"],
    "status": "active",
    "createdAt": "2026-04-23T12:00:00.000Z"
  }
}
```

`GET /api/matters`

Query parameters:

- `cursor`
- `limit`
- `status`

`GET /api/matters/:matterId`

Returns matter detail, recent documents, artifacts, and activity needed for the matter overview.

`PATCH /api/matters/:matterId`

Allowed fields:

- `name`
- `clientReference`
- `primaryJurisdiction`
- `secondaryJurisdictions`
- `legalDomains`
- `status`

`DELETE /api/matters/:matterId`

Soft-deletes the matter in Phase 0 unless a documented administrative hard-delete path is added later.

## Documents

`POST /api/matters/:matterId/documents`

Phase 0 may use direct multipart upload through the API or a presigned object-storage flow. The chosen implementation must preserve the same resulting document contract.

Required upload metadata:

- `filename`
- `fileType`
- `contentSha256`
- `sizeBytes`

Response: `201 Created`

```json
{
  "document": {
    "id": "doc_...",
    "matterId": "mat_...",
    "currentVersionId": "ver_...",
    "logicalKey": "doc_..."
  },
  "version": {
    "id": "ver_...",
    "versionNumber": 1,
    "filename": "skeleton-argument.pdf",
    "fileType": "application/pdf",
    "documentStatus": "queued",
    "syncState": "synced",
    "createdAt": "2026-04-23T12:00:00.000Z"
  }
}
```

`GET /api/matters/:matterId/documents`

Returns non-deleted logical documents and their current versions.

`GET /api/documents/:documentId`

Returns the logical document, version history, processing status, and available artifacts.

`DELETE /api/documents/:documentId`

Soft-deletes the logical document and records an audit entry. It must not physically remove object-storage data unless an explicit hard-delete path is used.

## Document Versions

`POST /api/documents/:documentId/versions`

Creates a new immutable version under an existing logical document.

Rules:

- version numbers must be monotonic per logical document
- uploads never overwrite an existing version
- sync conflicts create new versions
- `currentVersionId` moves only after the new version is persisted

## Jobs And Status

`GET /api/documents/:documentId/status`

Returns current processing state for the logical document and current version.

`GET /api/document-versions/:versionId/status`

Returns status for one immutable version.

Minimum statuses:

- `queued`
- `processing`
- `ready`
- `failed`
- `needs_review`

Failed responses must include a non-sensitive failure reason safe for UI display.

## Artifacts

Use `artifacts` as the canonical product and schema term. A report is an artifact with a report-like `artifactType`.

`GET /api/matters/:matterId/artifacts`

Returns artifacts for the matter.

`GET /api/artifacts/:artifactId`

Returns artifact metadata.

`GET /api/artifacts/:artifactId/download`

Returns a short-lived download URL or streams the artifact. Every successful download must create an audit log entry.

Artifact statuses:

- `queued`
- `generating`
- `ready`
- `failed`

## Activity And Audit

`GET /api/matters/:matterId/activity`

Returns user-facing activity derived from audit logs.

Direct audit-log export endpoints are not required for M0.1-M0.3, but audit records must be created as soon as mutating matter/document/artifact behavior exists.

## Permission Rules

Phase 0 roles:

- `owner`
- `admin`
- `member`

Initial permission model:

- `owner` and `admin` may create, update, and delete matters and documents.
- `member` may create matters and upload documents unless later restricted by org policy.
- all roles may read matters and documents inside their organisation.
- cross-organisation access must return `404` or `forbidden`; it must never leak the existence of another organisation's record.
