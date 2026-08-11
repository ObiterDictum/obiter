import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  OoxmlError,
  applyDocumentEdits,
  reconcileDocumentEdits,
  serialiseDocx,
} from '@obiter/ooxml'
import { findExistingCollaborationMerge } from './document-collaboration-db'
import {
  commitPreparedVersion,
  DocumentEditStoreError,
  isCanonicalReadyDocxVersion,
  lockCurrentAndBaseVersions,
  rollback,
} from './document-version-commit'
import {
  DocumentEditInvalidError,
  readSourceDocument,
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
  | { status: 'sync_id_conflict' }
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
  let client
  try {
    client = await pool.connect()
  } catch {
    throw new DocumentEditStoreError()
  }
  let commitStarted = false

  try {
    await client.query('begin')
    const locked = await lockCurrentAndBaseVersions(client, input)
    if (!locked) {
      await client.query('rollback')
      return { status: 'not_found' }
    }

    const operationsSha256 = hashOperations(input.operations)
    const existing = await findExistingCollaborationMerge(client, input)
    if (existing) {
      await client.query('rollback')
      if (existing.operations_sha256 !== operationsSha256) {
        return { status: 'sync_id_conflict' }
      }
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
      !isCanonicalReadyDocxVersion(current, input) ||
      !isCanonicalReadyDocxVersion(base, input)
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

    commitStarted = true
    const committed = await commitPreparedVersion(client, storage, {
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      userId: input.userId,
      requestId: input.requestId,
      expectedCurrentVersionId: current.id,
      parentVersion: current,
      preparedBytes: mergedBytes,
      audit: {
        action: 'document.collaboration_merge',
        metadata: (versionId) => ({
          syncId: input.syncId,
          baseVersionId: input.baseVersionId,
          newVersionId: versionId,
          operationCount: input.operations.length,
          operationsSha256,
          outcome: 'merged',
        }),
      },
    })
    if (committed.status === 'stale') {
      return {
        status: 'conflict',
        currentVersionId: current.id,
        currentVersionNumber: current.versionNumber,
        operationIndexes: input.operations.map((_, index) => index),
      }
    }
    return {
      status: 'merged',
      baseVersionId: input.baseVersionId,
      versionId: committed.versionId,
      versionNumber: committed.versionNumber,
    }
  } catch (error) {
    if (!commitStarted) await rollback(client)
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

function hashOperations(operations: readonly DocumentEditOperation[]) {
  return createHash('sha256').update(canonicalJson(operations)).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    )
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`
  }
  const serialised = JSON.stringify(value)
  if (serialised === undefined) throw new DocumentEditInvalidError()
  return serialised
}
