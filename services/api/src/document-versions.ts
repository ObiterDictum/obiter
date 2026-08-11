import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type {
  DocumentEditOperation,
  DocumentTrackedChangeDecisionRequest,
} from '@obiter/contracts'
import {
  OoxmlError,
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import {
  appendAuditLog,
  createDocumentObjectKey,
  insertDocumentVersion,
  type AuditRecordInput,
  type DocumentVersionRecord,
} from './database'
import type { StorageService } from './storage'

type VersionMutationInput = {
  organisationId: string
  matterId: string
  documentId: string
  baseVersionId: string
  baseVersion: DocumentVersionRecord
  userId: string
  requestId: string
}

type EditedVersionInput = VersionMutationInput & {
  operations: readonly DocumentEditOperation[]
  trackChanges: boolean
  userName?: string
  now?: () => Date
}

type TrackedChangeDecisionVersionInput = VersionMutationInput & {
  action: DocumentTrackedChangeDecisionRequest['action']
  changeIds: readonly string[]
}

type LockedBaseRow = {
  current_version_id: string | null
  matter_id: string
  base_id: string | null
  version_number: number | null
  filename: string | null
  file_type: string | null
}

type MutationAudit = {
  action: Extract<
    AuditRecordInput['action'],
    | 'document.edit'
    | 'document.tracked_change_accept'
    | 'document.tracked_change_reject'
  >
  metadata: (versionId: string) => AuditRecordInput['metadata']
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

export class DocumentTrackedChangeReadError extends Error {
  constructor() {
    super('The tracked changes could not be read.')
    this.name = new.target.name
  }
}

export async function createEditedVersion(
  pool: Pool,
  storage: StorageService,
  input: EditedVersionInput,
): Promise<CreateEditedVersionResult> {
  const editedBytes = await prepareSource(storage, input, (document) => {
    applyDocumentEdits(
      document,
      input.operations,
      input.trackChanges
        ? {
            author: input.userName?.trim() || input.userId,
            date: (input.now?.() ?? new Date()).toISOString(),
          }
        : undefined,
    )
  })
  return createPreparedVersion(pool, storage, input, editedBytes, {
    action: 'document.edit',
    metadata: (versionId) => ({
      baseVersionId: input.baseVersionId,
      newVersionId: versionId,
      operationCount: input.operations.length,
    }),
  })
}

export async function createTrackedChangeDecisionVersion(
  pool: Pool,
  storage: StorageService,
  input: TrackedChangeDecisionVersionInput,
): Promise<CreateEditedVersionResult> {
  let resolvedChangeIds: string[] = []
  const editedBytes = await prepareSource(storage, input, (document) => {
    resolvedChangeIds = applyTrackedChangeDecisions(
      document,
      input.changeIds,
      input.action,
    )
  })
  return createPreparedVersion(pool, storage, input, editedBytes, {
    action:
      input.action === 'accept'
        ? 'document.tracked_change_accept'
        : 'document.tracked_change_reject',
    metadata: (versionId) => ({
      documentId: input.documentId,
      baseVersionId: input.baseVersionId,
      newVersionId: versionId,
      action: input.action,
      changeIds: resolvedChangeIds,
    }),
  })
}

export async function readDocumentTrackedChanges(
  storage: StorageService,
  input: Pick<
    VersionMutationInput,
    | 'organisationId'
    | 'matterId'
    | 'documentId'
    | 'baseVersionId'
    | 'baseVersion'
  >,
) {
  try {
    validateBaseVersion(input)
    const document = await readSourceDocument(storage, input.baseVersion)
    return document.model.changes
  } catch {
    throw new DocumentTrackedChangeReadError()
  }
}

async function prepareSource(
  storage: StorageService,
  input: VersionMutationInput,
  mutate: (document: Awaited<ReturnType<typeof parseDocx>>) => void,
) {
  validateBaseVersion(input)
  const document = await readSourceDocument(storage, input.baseVersion)
  try {
    mutate(document)
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

export async function readSourceDocument(
  storage: StorageService,
  version: Pick<DocumentVersionRecord, 'objectKey'>,
) {
  if (!storage.readBinary) throw new DocumentEditStoreError()
  let source: Buffer
  try {
    source = await storage.readBinary(version.objectKey)
  } catch {
    throw new DocumentEditStoreError()
  }
  try {
    return await parseDocx(source)
  } catch {
    throw new DocumentEditStoreError()
  }
}

async function createPreparedVersion(
  pool: Pool,
  storage: StorageService,
  input: VersionMutationInput,
  editedBytes: Uint8Array,
  audit: MutationAudit,
): Promise<CreateEditedVersionResult> {
  const contentSha256 = createHash('sha256').update(editedBytes).digest('hex')
  let client: PoolClient
  try {
    client = await pool.connect()
  } catch {
    throw new DocumentEditStoreError()
  }
  let candidateKey: string | null = null
  let commitIssued = false

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

    await insertDocumentVersion(client, {
      id: versionId,
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      filename: lock.filename,
      fileType: lock.file_type,
      sizeBytes: editedBytes.byteLength,
      objectKey: candidateKey,
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber,
      contentSha256,
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
      action: audit.action,
      metadata: audit.metadata(versionId),
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
  } finally {
    client.release()
  }
}

function validateBaseVersion(
  input: Pick<
    VersionMutationInput,
    | 'organisationId'
    | 'matterId'
    | 'documentId'
    | 'baseVersionId'
    | 'baseVersion'
  >,
) {
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

async function lockBaseVersion(
  client: PoolClient,
  input: VersionMutationInput,
) {
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

export async function writeCandidate(
  storage: StorageService,
  objectKey: string,
  bytes: Uint8Array,
) {
  if (!storage.writeBinary) throw new DocumentEditStoreError()
  await storage.writeBinary(objectKey, Buffer.from(bytes))
}

export async function rollback(client: PoolClient) {
  try {
    await client.query('rollback')
  } catch {
    // The public failure remains curated when rollback cannot be confirmed.
  }
}

export async function cleanupCandidate(
  storage: StorageService,
  objectKey: string,
) {
  try {
    await storage.delete(objectKey)
  } catch {
    throw new DocumentEditStoreError()
  }
}
