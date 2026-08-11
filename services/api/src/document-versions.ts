import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  OoxmlError,
  applyDocumentEdits,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import {
  appendAuditLog,
  createDocumentObjectKey,
  type DocumentVersionRecord,
} from './database'
import type { StorageService } from './storage'

type EditedVersionInput = {
  organisationId: string
  matterId: string
  documentId: string
  baseVersionId: string
  baseVersion: DocumentVersionRecord
  operations: readonly DocumentEditOperation[]
  userId: string
  requestId: string
}

type LockedBaseRow = {
  current_version_id: string | null
  matter_id: string
  base_id: string | null
  version_number: number | null
  filename: string | null
  file_type: string | null
}

export type CreateEditedVersionResult =
  | { status: 'created'; versionId: string; versionNumber: number }
  | { status: 'stale' }
  | { status: 'not_found' }

export class DocumentEditInvalidError extends Error {
  constructor() {
    super('The document edit is invalid.')
    this.name = new.target.name
  }
}

export class DocumentEditStoreError extends Error {
  constructor() {
    super('The edited document could not be stored.')
    this.name = new.target.name
  }
}

export async function createEditedVersion(
  pool: Pool,
  storage: StorageService,
  input: EditedVersionInput,
): Promise<CreateEditedVersionResult> {
  validateBaseVersion(input)
  const editedBytes = await prepareEditedSource(storage, input)
  const contentSha256 = createHash('sha256').update(editedBytes).digest('hex')
  let client: PoolClient
  try {
    client = await pool.connect()
  } catch {
    throw new DocumentEditStoreError()
  }
  let candidateKey: string | null = null

  try {
    await client.query('begin')
    const lock = await lockBaseVersion(client, input)
    if (!lock) {
      await client.query('rollback')
      return { status: 'not_found' }
    }
    if (
      lock.current_version_id !== input.baseVersionId ||
      lock.base_id !== input.baseVersionId
    ) {
      await client.query('rollback')
      return { status: 'stale' }
    }
    if (
      lock.version_number === null ||
      lock.filename === null ||
      lock.file_type !== 'docx'
    ) {
      await client.query('rollback')
      return { status: 'not_found' }
    }

    const versionId = `ver_${crypto.randomUUID()}`
    const versionNumber = lock.version_number + 1
    candidateKey = createDocumentObjectKey({
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      versionId,
    })
    await writeCandidate(storage, candidateKey, editedBytes)

    await client.query(
      `
        insert into document_versions (
          id, organisation_id, matter_id, matter_document_id, filename, file_type,
          size_bytes, object_key, text_object_key, document_status, failure_reason,
          version_number, content_sha256, sync_state, created_by, created_at, updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, null, 'ready', null,
          $9, $10, 'synced', $11, now(), now()
        )
      `,
      [
        versionId,
        input.organisationId,
        input.matterId,
        input.documentId,
        lock.filename,
        lock.file_type,
        editedBytes.byteLength,
        candidateKey,
        versionNumber,
        contentSha256,
        input.userId,
      ],
    )

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
        input.baseVersionId,
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
        baseVersionId: input.baseVersionId,
        versionNumber,
      },
      requestId: input.requestId,
    })
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'document',
      entityId: input.documentId,
      action: 'document.edit',
      metadata: {
        baseVersionId: input.baseVersionId,
        newVersionId: versionId,
        operationCount: input.operations.length,
      },
      requestId: input.requestId,
    })

    await client.query('commit')
    candidateKey = null
    return { status: 'created', versionId, versionNumber }
  } catch {
    await rollback(client)
    if (candidateKey) await cleanupCandidate(storage, candidateKey)
    throw new DocumentEditStoreError()
  } finally {
    client.release()
  }
}

function validateBaseVersion(input: EditedVersionInput) {
  const expectedKey = createDocumentObjectKey({
    organisationId: input.organisationId,
    matterId: input.matterId,
    documentId: input.documentId,
    versionId: input.baseVersionId,
  })
  const valid =
    input.baseVersion.id === input.baseVersionId &&
    input.baseVersion.organisationId === input.organisationId &&
    input.baseVersion.matterId === input.matterId &&
    input.baseVersion.matterDocumentId === input.documentId &&
    input.baseVersion.fileType === 'docx' &&
    input.baseVersion.documentStatus === 'ready' &&
    input.baseVersion.objectKey === expectedKey
  if (!valid) throw new DocumentEditStoreError()
}

async function prepareEditedSource(
  storage: StorageService,
  input: EditedVersionInput,
) {
  if (!storage.readBinary) throw new DocumentEditStoreError()
  let source: Buffer
  try {
    source = await storage.readBinary(input.baseVersion.objectKey)
  } catch {
    throw new DocumentEditStoreError()
  }

  let document
  try {
    document = await parseDocx(source)
  } catch {
    throw new DocumentEditStoreError()
  }
  try {
    applyDocumentEdits(document, input.operations)
  } catch (error) {
    if (error instanceof OoxmlError) throw new DocumentEditInvalidError()
    throw new DocumentEditStoreError()
  }
  try {
    return await serialiseDocx(document)
  } catch {
    throw new DocumentEditStoreError()
  }
}

async function lockBaseVersion(client: PoolClient, input: EditedVersionInput) {
  const result = await client.query<LockedBaseRow>(
    `
      select
        document.current_version_id,
        document.matter_id,
        base.id as base_id,
        base.version_number,
        base.filename,
        base.file_type
      from matter_documents document
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
  return result.rows[0] ?? null
}

async function writeCandidate(
  storage: StorageService,
  objectKey: string,
  bytes: Uint8Array,
) {
  if (!storage.writeBinary) throw new DocumentEditStoreError()
  await storage.writeBinary(objectKey, Buffer.from(bytes))
}

async function rollback(client: PoolClient) {
  try {
    await client.query('rollback')
  } catch {
    // The public failure remains curated even when the failed transaction
    // cannot confirm its rollback state.
  }
}

async function cleanupCandidate(storage: StorageService, objectKey: string) {
  try {
    await storage.delete(objectKey)
  } catch {
    throw new DocumentEditStoreError()
  }
}
