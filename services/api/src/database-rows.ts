import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import type {
  DocumentStatus,
  MatterDocumentRecord,
  MatterRecord,
  MatterStatus,
  DocumentVersionRecord,
  DocumentVersionRedaction,
  SyncState,
} from './database-records'

export type Queryable = Pick<Pool | PoolClient, 'query'>

export type MatterRow = {
  id: string
  organisation_id: string
  name: string
  description: string | null
  primary_jurisdiction: string
  secondary_jurisdictions: string[]
  legal_domains: string[]
  client_reference: string
  status: MatterStatus
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
  deleted_by: string | null
}

export type DocumentVersionRow = {
  id: string
  organisation_id: string
  matter_id: string
  matter_document_id: string
  filename: string
  file_type: string
  size_bytes: string
  object_key: string
  text_object_key: string | null
  document_status: DocumentStatus
  failure_reason: string | null
  version_number: number
  content_sha256: string
  sync_state: SyncState
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  lineage: unknown
}

export type MatterDocumentRow = {
  id: string
  organisation_id: string
  matter_id: string
  current_version_id: string | null
  logical_key: string
  created_by: string
  created_at: Date | string
  updated_at: Date | string
  deleted_at: Date | string | null
  deleted_by: string | null
}

function timestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value
}

function nullableTimestamp(value: Date | string | null) {
  return value === null ? null : timestamp(value)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function firstOrNull<Row extends QueryResultRow, Record>(
  result: QueryResult<Row>,
  mapper: (row: Row) => Record,
): Record | null {
  const row = result.rows[0]
  return row ? mapper(row) : null
}

export function mapMatter(row: MatterRow): MatterRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    description: row.description,
    primaryJurisdiction: row.primary_jurisdiction,
    secondaryJurisdictions: stringArray(row.secondary_jurisdictions),
    legalDomains: stringArray(row.legal_domains),
    clientReference: row.client_reference,
    status: row.status,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    deletedAt: nullableTimestamp(row.deleted_at),
    deletedBy: row.deleted_by,
  }
}

export function mapVersion(
  row: DocumentVersionRow,
  redaction: DocumentVersionRedaction | null = null,
): DocumentVersionRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    matterId: row.matter_id,
    matterDocumentId: row.matter_document_id,
    filename: row.filename,
    fileType: row.file_type,
    sizeBytes: row.size_bytes,
    objectKey: row.object_key,
    textObjectKey: row.text_object_key,
    documentStatus: row.document_status,
    failureReason: row.failure_reason,
    versionNumber: row.version_number,
    contentSha256: row.content_sha256,
    syncState: row.sync_state,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    lineage: row.lineage,
    redaction,
  }
}

export function mapDocument(row: MatterDocumentRow): MatterDocumentRecord {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    matterId: row.matter_id,
    currentVersionId: row.current_version_id,
    logicalKey: row.logical_key,
    createdBy: row.created_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    deletedAt: nullableTimestamp(row.deleted_at),
    deletedBy: row.deleted_by,
  }
}

export const matterColumns = `
  id, organisation_id, name, description, primary_jurisdiction,
  secondary_jurisdictions, legal_domains, client_reference, status,
  created_by, created_at, updated_at, deleted_at, deleted_by
`

export const documentColumns = `
  id, organisation_id, matter_id, current_version_id, logical_key,
  created_by, created_at, updated_at, deleted_at, deleted_by
`

export const versionColumns = `
  id, organisation_id, matter_id, matter_document_id, filename, file_type,
  size_bytes, object_key, text_object_key, document_status, failure_reason,
  version_number, content_sha256, sync_state, created_by, created_at, updated_at,
  lineage
`
