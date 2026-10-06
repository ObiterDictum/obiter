# Phase 0 Schema

## Purpose

This document defines the minimum implementation-grade Phase 0 schema. The exact migration tool is not mandated here, but migrations must preserve these entities, constraints, and legal-work safety rules.

## General Rules

- IDs are opaque string primary keys.
- Timestamps are stored as timezone-aware UTC values.
- Use `created_at` and `updated_at` on mutable records.
- Soft deletion uses `deleted_at`.
- Legal work must not be silently overwritten.
- Audit records are append-only.
- Organisation scoping is mandatory for private matter data.
- Enum values must be represented consistently in the database and shared contracts.

## Enums

### user_role

- `owner`
- `admin`
- `member`

### matter_status

- `active`
- `archived`
- `deleted`

### document_status

- `queued`
- `processing`
- `ready`
- `failed`
- `needs_review`

### sync_state

- `local_only`
- `queued`
- `syncing`
- `synced`
- `conflict`
- `failed`

### artifact_status

- `queued`
- `generating`
- `ready`
- `failed`

### artifact_type

Initial values:

- `document_text`
- `upload_receipt`
- `processing_log`
- `redaction_report`
- `verification_report`
- `research_memo`

Phase 0 mostly needs the first three. Phase 1 modules may add report artifacts without changing the artifact model.

## Tables

### organisations

Required fields:

- `id`
- `name`
- `plan`
- `data_region`
- `created_at`
- `updated_at`

Constraints:

- `data_region` defaults to `eu`.
- `plan` starts as `private_beta`.

### users

Required fields:

- `id`
- `organisation_id`
- `email`
- `name`
- `role`
- `created_at`
- `updated_at`

Constraints:

- `organisation_id` references `organisations.id`.
- `email` is unique for Phase 0.
- `role` is one of `owner`, `admin`, or `member`.
- one user belongs to one organisation in Phase 0.

### sessions

`better-auth` may own the concrete session tables. The application must still be able to resolve:

- session id
- user id
- expiry
- device or client label where available
- created at
- revoked or invalidated state where available

If `better-auth` creates additional tables, do not duplicate session truth in application tables. Add only application-specific metadata if needed.

### audit_logs

Required fields:

- `id`
- `organisation_id`
- `user_id`
- `entity_type`
- `entity_id`
- `action`
- `metadata_json`
- `request_id`
- `created_at`

Constraints:

- append-only
- `organisation_id` references `organisations.id`
- `user_id` references `users.id` where available
- `metadata_json` must not store raw document text or secrets

Initial audited actions:

- `auth.sign_in`
- `auth.sign_out`
- `matter.create`
- `matter.update`
- `matter.delete`
- `document.upload`
- `document.version_create`
- `document.delete`
- `artifact.create`
- `artifact.download`

### matters

Required fields:

- `id`
- `organisation_id`
- `name`
- `primary_jurisdiction`
- `secondary_jurisdictions`
- `legal_domains`
- `client_reference`
- `status`
- `created_by`
- `created_at`
- `updated_at`
- `deleted_at`

Constraints:

- `organisation_id` references `organisations.id`.
- `created_by` references `users.id`.
- `primary_jurisdiction` is required.
- `secondary_jurisdictions` is an array or JSON list.
- `legal_domains` is an array or JSON list.
- `status` is one of `active`, `archived`, or `deleted`.

Indexes:

- `organisation_id`
- `organisation_id, status`
- `organisation_id, created_at`

### matter_documents

This table represents one logical document across immutable versions.

Required fields:

- `id`
- `matter_id`
- `current_version_id`
- `logical_key`
- `created_by`
- `deleted_at`
- `created_at`
- `updated_at`

Constraints:

- `matter_id` references `matters.id`.
- `current_version_id` references `document_versions.id` after the first version exists.
- `logical_key` is stable and must not be reused across documents.
- deleting a document soft-deletes the logical document, not the versions.

Indexes:

- `matter_id`
- `matter_id, deleted_at`

### document_versions

This table is immutable after creation except for processing and sync status fields.

Required fields:

- `id`
- `matter_document_id`
- `filename`
- `file_type`
- `size_bytes`
- `object_key`
- `text_object_key`
- `document_status`
- `failure_reason`
- `version_number`
- `content_sha256`
- `sync_state`
- `created_by`
- `created_at`
- `updated_at`

Constraints:

- `matter_document_id` references `matter_documents.id`.
- `version_number` is unique per `matter_document_id`.
- `content_sha256` is required.
- `object_key` is required for cloud-backed versions.
- `text_object_key` is nullable until extraction completes.
- `failure_reason` must not contain raw sensitive document text.

Indexes:

- `matter_document_id, version_number`
- `content_sha256`
- `document_status`
- `sync_state`

### artifacts

Required fields:

- `id`
- `matter_id`
- `document_id`
- `document_version_id`
- `artifact_type`
- `status`
- `object_key`
- `failure_reason`
- `created_by`
- `created_at`
- `updated_at`

Constraints:

- `matter_id` references `matters.id`.
- `document_id` references `matter_documents.id` where the artifact belongs to a document.
- `document_version_id` references `document_versions.id` where the artifact belongs to a version.
- `object_key` is nullable until the artifact is ready.
- `failure_reason` must be safe for UI display.

Indexes:

- `matter_id`
- `document_id`
- `document_version_id`
- `status`

## Object Key Strategy

Object keys must avoid raw client names and raw filenames.

Recommended shape:

```text
org/{organisation_id}/matters/{matter_id}/documents/{document_id}/versions/{version_id}/source
org/{organisation_id}/matters/{matter_id}/documents/{document_id}/versions/{version_id}/text
org/{organisation_id}/matters/{matter_id}/artifacts/{artifact_id}
```

Original filenames belong in metadata, not object keys.

## Local Desktop Data

Desktop-local records must map cleanly to server records when synced.

Local-only records should carry:

- local id
- eventual server id when synced
- sync state
- operation id
- content hash where applicable
- created at

When a local and remote edit conflict, create a new document version instead of overwriting either side.
