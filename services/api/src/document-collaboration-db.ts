import type { PoolClient } from 'pg'
import type { DocumentVersionRecord } from './database'

export type CollaborationLockedVersion = Pick<
  DocumentVersionRecord,
  | 'id'
  | 'organisationId'
  | 'matterId'
  | 'matterDocumentId'
  | 'filename'
  | 'fileType'
  | 'objectKey'
  | 'documentStatus'
  | 'versionNumber'
>

type CollaborationScope = {
  organisationId: string
  matterId: string
  documentId: string
  baseVersionId: string
}

type LockedCollaborationRow = {
  current_id: string | null
  current_organisation_id: string | null
  current_matter_id: string | null
  current_document_id: string | null
  current_filename: string | null
  current_file_type: string | null
  current_object_key: string | null
  current_status: DocumentVersionRecord['documentStatus'] | null
  current_version_number: number | null
  base_id: string | null
  base_organisation_id: string | null
  base_matter_id: string | null
  base_document_id: string | null
  base_filename: string | null
  base_file_type: string | null
  base_object_key: string | null
  base_status: DocumentVersionRecord['documentStatus'] | null
  base_version_number: number | null
}

type ExistingMergeRow = {
  base_version_id: string
  version_id: string
  version_number: number
}

export async function lockCollaborationVersions(
  client: PoolClient,
  input: CollaborationScope,
) {
  const result = await client.query<LockedCollaborationRow>(
    `
      select
        current.id as current_id,
        current.organisation_id as current_organisation_id,
        current.matter_id as current_matter_id,
        current.matter_document_id as current_document_id,
        current.filename as current_filename,
        current.file_type as current_file_type,
        current.object_key as current_object_key,
        current.document_status as current_status,
        current.version_number as current_version_number,
        base.id as base_id,
        base.organisation_id as base_organisation_id,
        base.matter_id as base_matter_id,
        base.matter_document_id as base_document_id,
        base.filename as base_filename,
        base.file_type as base_file_type,
        base.object_key as base_object_key,
        base.document_status as base_status,
        base.version_number as base_version_number
      from matter_documents document
      left join document_versions current
        on current.id = document.current_version_id
        and current.organisation_id = document.organisation_id
        and current.matter_id = document.matter_id
        and current.matter_document_id = document.id
      left join document_versions base
        on base.id = $4
        and base.organisation_id = document.organisation_id
        and base.matter_id = document.matter_id
        and base.matter_document_id = document.id
      where document.id = $1
        and document.organisation_id = $2
        and document.matter_id = $3
        and document.deleted_at is null
      for update of document
    `,
    [
      input.documentId,
      input.organisationId,
      input.matterId,
      input.baseVersionId,
    ],
  )
  const row = result.rows[0]
  if (!row) return null
  return { current: currentVersion(row), base: baseVersion(row) }
}

export async function findExistingCollaborationMerge(
  client: PoolClient,
  input: {
    organisationId: string
    documentId: string
    userId: string
    syncId: string
  },
) {
  const result = await client.query<ExistingMergeRow>(
    `
      select
        audit.metadata_json ->> 'baseVersionId' as base_version_id,
        version.id as version_id,
        version.version_number
      from audit_logs audit
      join document_versions version
        on version.id = audit.metadata_json ->> 'newVersionId'
        and version.organisation_id = audit.organisation_id
        and version.matter_document_id = audit.entity_id
      where audit.organisation_id = $1
        and audit.entity_type = 'document'
        and audit.entity_id = $2
        and audit.user_id = $3
        and audit.action = 'document.collaboration_merge'
        and audit.metadata_json ->> 'syncId' = $4
        and audit.metadata_json ->> 'outcome' = 'merged'
      order by audit.created_at asc
      limit 1
    `,
    [input.organisationId, input.documentId, input.userId, input.syncId],
  )
  return result.rows[0] ?? null
}

function currentVersion(
  row: LockedCollaborationRow,
): CollaborationLockedVersion | null {
  if (
    row.current_id === null ||
    row.current_organisation_id === null ||
    row.current_matter_id === null ||
    row.current_document_id === null ||
    row.current_filename === null ||
    row.current_file_type === null ||
    row.current_object_key === null ||
    row.current_status === null ||
    row.current_version_number === null
  ) {
    return null
  }
  return {
    id: row.current_id,
    organisationId: row.current_organisation_id,
    matterId: row.current_matter_id,
    matterDocumentId: row.current_document_id,
    filename: row.current_filename,
    fileType: row.current_file_type,
    objectKey: row.current_object_key,
    documentStatus: row.current_status,
    versionNumber: row.current_version_number,
  }
}

function baseVersion(
  row: LockedCollaborationRow,
): CollaborationLockedVersion | null {
  if (
    row.base_id === null ||
    row.base_organisation_id === null ||
    row.base_matter_id === null ||
    row.base_document_id === null ||
    row.base_filename === null ||
    row.base_file_type === null ||
    row.base_object_key === null ||
    row.base_status === null ||
    row.base_version_number === null
  ) {
    return null
  }
  return {
    id: row.base_id,
    organisationId: row.base_organisation_id,
    matterId: row.base_matter_id,
    matterDocumentId: row.base_document_id,
    filename: row.base_filename,
    fileType: row.base_file_type,
    objectKey: row.base_object_key,
    documentStatus: row.base_status,
    versionNumber: row.base_version_number,
  }
}
