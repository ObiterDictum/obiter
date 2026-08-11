import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  OoxmlError,
  applyDocumentEdits,
  reconcileDocumentEdits,
  serialiseDocx,
} from '@obiter/ooxml'
import {
  findExistingCollaborationMerge,
  lockCollaborationVersions,
  type CollaborationLockedVersion,
} from './document-collaboration-db'
import {
  appendAuditLog,
  createDocumentObjectKey,
  insertDocumentVersion,
} from './database'
import {
  cleanupCandidate,
  DocumentEditInvalidError,
  DocumentEditStoreError,
  readSourceDocument,
  rollback,
  writeCandidate,
} from './document-versions'
import type { StorageService } from './storage'

type CollaborationMergeInput = {
  organisationId: string
  matterId: string
  documentId: string
  baseVersionId: string
  syncId: string
  operations: readonly DocumentEditOperation[]
  trackChanges: boolean
  userId: string
  userName?: string
  requestId: string
  now?: () => Date
}

export type CollaborationMergeResult =
  | {
      status: 'merged' | 'already_applied'
      baseVersionId: string
      versionId: string
      versionNumber: number
    }
  | {
      status: 'conflict'
      currentVersionId: string
      currentVersionNumber: number
      operationIndexes: number[]
    }
  | { status: 'not_found' }

export async function createCollaborationMergeVersion(
  pool: Pool,
  storage: StorageService,
  input: CollaborationMergeInput,
): Promise<CollaborationMergeResult> {
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
    const locked = await lockCollaborationVersions(client, input)
    if (!locked) {
      await client.query('rollback')
      return { status: 'not_found' }
    }

    const existing = await findExistingCollaborationMerge(client, input)
    if (existing) {
      await client.query('rollback')
      return {
        status: 'already_applied',
        baseVersionId: existing.base_version_id,
        versionId: existing.version_id,
        versionNumber: existing.version_number,
      }
    }

    const { current, base } = locked
    if (
      !current ||
      !base ||
      !validLockedVersion(current, input) ||
      !validLockedVersion(base, input)
    ) {
      await client.query('rollback')
      return { status: 'not_found' }
    }

    const baseIsCurrent = base.id === current.id
    const currentDocument = await readSourceDocument(storage, current)
    const baseDocument = baseIsCurrent
      ? currentDocument
      : await readSourceDocument(storage, base)
    const reconciliation = reconcileDocumentEdits(
      baseDocument,
      currentDocument,
      input.operations,
      baseIsCurrent,
    )
    if (!reconciliation.mergeable) {
      await client.query('rollback')
      return {
        status: 'conflict',
        currentVersionId: current.id,
        currentVersionNumber: current.versionNumber,
        operationIndexes: reconciliation.operationIndexes,
      }
    }

    try {
      applyDocumentEdits(
        currentDocument,
        input.operations,
        input.trackChanges
          ? {
              author: input.userName?.trim() || input.userId,
              date: (input.now?.() ?? new Date()).toISOString(),
            }
          : undefined,
      )
    } catch (error) {
      if (error instanceof OoxmlError) throw new DocumentEditInvalidError()
      throw new DocumentEditStoreError()
    }
    let mergedBytes: Uint8Array
    try {
      mergedBytes = await serialiseDocx(currentDocument)
    } catch {
      throw new DocumentEditStoreError()
    }

    const versionId = `ver_${crypto.randomUUID()}`
    const versionNumber = current.versionNumber + 1
    candidateKey = createDocumentObjectKey({
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      versionId,
    })
    await writeCandidate(storage, candidateKey, mergedBytes)
    await insertDocumentVersion(client, {
      id: versionId,
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      filename: current.filename,
      fileType: current.fileType,
      sizeBytes: mergedBytes.byteLength,
      objectKey: candidateKey,
      textObjectKey: null,
      documentStatus: 'ready',
      failureReason: null,
      versionNumber,
      contentSha256: createHash('sha256').update(mergedBytes).digest('hex'),
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
        current.id,
        versionId,
      ],
    )
    if (pointer.rows.length !== 1) {
      await client.query('rollback')
      await cleanupCandidate(storage, candidateKey)
      candidateKey = null
      return {
        status: 'conflict',
        currentVersionId: current.id,
        currentVersionNumber: current.versionNumber,
        operationIndexes: input.operations.map((_, index) => index),
      }
    }

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'document_version',
      entityId: versionId,
      action: 'document.version_create',
      metadata: {
        documentId: input.documentId,
        baseVersionId: current.id,
        versionNumber,
      },
      requestId: input.requestId,
    })
    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'document',
      entityId: input.documentId,
      action: 'document.collaboration_merge',
      metadata: {
        syncId: input.syncId,
        baseVersionId: input.baseVersionId,
        newVersionId: versionId,
        operationCount: input.operations.length,
        outcome: 'merged',
      },
      requestId: input.requestId,
    })

    commitIssued = true
    await client.query('commit')
    candidateKey = null
    return {
      status: 'merged',
      baseVersionId: input.baseVersionId,
      versionId,
      versionNumber,
    }
  } catch (error) {
    if (!commitIssued) {
      await rollback(client)
      if (candidateKey) await cleanupCandidate(storage, candidateKey)
    }
    if (
      error instanceof DocumentEditInvalidError ||
      error instanceof DocumentEditStoreError
    ) {
      throw error
    }
    throw new DocumentEditStoreError()
  } finally {
    client.release()
  }
}

function validLockedVersion(
  version: CollaborationLockedVersion,
  input: CollaborationMergeInput,
) {
  return (
    version.organisationId === input.organisationId &&
    version.matterId === input.matterId &&
    version.matterDocumentId === input.documentId &&
    version.fileType === 'docx' &&
    version.documentStatus === 'ready' &&
    version.objectKey ===
      createDocumentObjectKey({
        organisationId: input.organisationId,
        matterId: input.matterId,
        documentId: input.documentId,
        versionId: version.id,
      })
  )
}
