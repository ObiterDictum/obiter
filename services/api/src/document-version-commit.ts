import { createHash } from 'node:crypto'
import type { PoolClient } from 'pg'
import {
  appendAuditLog,
  createDocumentObjectKey,
  insertDocumentVersion,
  type AuditRecordInput,
  type DocumentVersionRecord,
} from './database'
import type { StorageService } from './storage'

export type DocumentVersionScope = {
  organisationId: string
  matterId: string
  documentId: string
}

export type LockedDocumentVersion = Pick<
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

type LockedDocumentVersionsRow = {
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

type PreparedVersionAudit = {
  action: AuditRecordInput['action']
  metadata: (versionId: string) => AuditRecordInput['metadata']
}

type PreparedVersionCommitInput = DocumentVersionScope & {
  userId: string
  requestId: string
  expectedCurrentVersionId: string
  parentVersion: LockedDocumentVersion
  preparedBytes: Uint8Array
  audit: PreparedVersionAudit
}

export type PreparedVersionCommitResult =
  | { status: 'created'; versionId: string; versionNumber: number }
  | { status: 'stale' }

export class DocumentEditStoreError extends Error {
  constructor() {
    super('The edited document could not be stored.')
    this.name = new.target.name
  }
}

export async function lockCurrentAndBaseVersions(
  client: PoolClient,
  input: DocumentVersionScope & { baseVersionId: string },
) {
  const result = await client.query<LockedDocumentVersionsRow>(
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
  return {
    current: lockedVersion(row, 'current'),
    base: lockedVersion(row, 'base'),
  }
}

export function isCanonicalReadyDocxVersion(
  version: LockedDocumentVersion,
  scope: DocumentVersionScope,
) {
  return (
    version.organisationId === scope.organisationId &&
    version.matterId === scope.matterId &&
    version.matterDocumentId === scope.documentId &&
    version.fileType === 'docx' &&
    version.documentStatus === 'ready' &&
    version.objectKey ===
      createDocumentObjectKey({
        ...scope,
        versionId: version.id,
      })
  )
}

export async function commitPreparedVersion(
  client: PoolClient,
  storage: StorageService,
  input: PreparedVersionCommitInput,
): Promise<PreparedVersionCommitResult> {
  let candidateKey: string | null = null
  let commitIssued = false

  try {
    const versionId = `ver_${crypto.randomUUID()}`
    const versionNumber = input.parentVersion.versionNumber + 1
    candidateKey = createDocumentObjectKey({
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      versionId,
    })
    await writeCandidate(storage, candidateKey, input.preparedBytes)

    await insertDocumentVersion(client, {
      id: versionId,
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      filename: input.parentVersion.filename,
      fileType: input.parentVersion.fileType,
      sizeBytes: input.preparedBytes.byteLength,
      objectKey: candidateKey,
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber,
      contentSha256: createHash('sha256')
        .update(input.preparedBytes)
        .digest('hex'),
      syncState: 'synced',
      createdBy: input.userId,
    })

    const pointer = await client.query<{ id: string }>(
      `
        update matter_documents
        set current_version_id = $5, updated_at = now()
        where id = $1
          and organisation_id = $2
          and matter_id = $3
          and current_version_id = $4
          and deleted_at is null
        returning id
      `,
      [
        input.documentId,
        input.organisationId,
        input.matterId,
        input.expectedCurrentVersionId,
        versionId,
      ],
    )
    if (pointer.rows.length !== 1) {
      await client.query('rollback')
      await cleanupCandidate(storage, candidateKey)
      candidateKey = null
      return { status: 'stale' }
    }

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'document_version',
      entityId: versionId,
      action: 'document.version_create',
      metadata: {
        documentId: input.documentId,
        // This is the lineage parent; a collaboration audit may record the client's stale base separately.
        baseVersionId: input.parentVersion.id,
        versionNumber,
      },
      requestId: input.requestId,
    })
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'document',
      entityId: input.documentId,
      action: input.audit.action,
      metadata: input.audit.metadata(versionId),
      requestId: input.requestId,
    })

    commitIssued = true
    await client.query('commit')
    candidateKey = null
    return { status: 'created', versionId, versionNumber }
  } catch {
    if (!commitIssued) {
      await rollback(client)
      if (candidateKey) await cleanupCandidate(storage, candidateKey)
    }
    // Once COMMIT is sent, its response can fail after PostgreSQL has committed.
    // Keep the candidate object in that uncertain state rather than deleting an
    // object that a committed immutable version may require.
    throw new DocumentEditStoreError()
  }
}

export async function rollback(client: PoolClient) {
  try {
    await client.query('rollback')
  } catch {
    // The public failure remains curated when rollback cannot be confirmed.
  }
}

async function writeCandidate(
  storage: StorageService,
  objectKey: string,
  bytes: Uint8Array,
) {
  if (!storage.writeBinary) throw new DocumentEditStoreError()
  await storage.writeBinary(objectKey, Buffer.from(bytes))
}

async function cleanupCandidate(storage: StorageService, objectKey: string) {
  try {
    await storage.delete(objectKey)
  } catch {
    throw new DocumentEditStoreError()
  }
}

function lockedVersion(
  row: LockedDocumentVersionsRow,
  side: 'current' | 'base',
): LockedDocumentVersion | null {
  const id = row[`${side}_id`]
  const organisationId = row[`${side}_organisation_id`]
  const matterId = row[`${side}_matter_id`]
  const matterDocumentId = row[`${side}_document_id`]
  const filename = row[`${side}_filename`]
  const fileType = row[`${side}_file_type`]
  const objectKey = row[`${side}_object_key`]
  const documentStatus = row[`${side}_status`]
  const versionNumber = row[`${side}_version_number`]
  if (
    id === null ||
    organisationId === null ||
    matterId === null ||
    matterDocumentId === null ||
    filename === null ||
    fileType === null ||
    objectKey === null ||
    documentStatus === null ||
    versionNumber === null
  ) {
    return null
  }
  return {
    id,
    organisationId,
    matterId,
    matterDocumentId,
    filename,
    fileType,
    objectKey,
    documentStatus,
    versionNumber,
  }
}
