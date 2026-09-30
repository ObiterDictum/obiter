import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import type {
  DocumentEditOperation,
  DocumentVersionLineage,
} from '@obiter/contracts'
import {
  OoxmlError,
  alignMergeDocuments,
  applyDocumentEdits,
  buildVersionLineage,
  canonicaliseParagraphIdentities,
  createLineageRecorder,
  reconcileDocumentEdits,
  remapMergeOperations,
  retargetLineageToBaseVersion,
  serialiseDocx,
} from '@obiter/ooxml'
import { findExistingCollaborationMerge } from './document-collaboration-db'
import { lockMatterForEdit } from './matter-lock'
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
      lineage?: DocumentVersionLineage
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
    // Matter before document, and before the idempotency lookup: a revoked
    // grantee must not learn through an already_applied replay that a sync id
    // was previously merged.
    if (!(await lockMatterForEdit(client, input))) {
      await client.query('rollback')
      return { status: 'not_found' }
    }
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
        ...(existing.lineage
          ? {
              // SAFETY: the column is a JSONB object written only by
              // `commitPreparedVersion` from a validated lineage, and the
              // database CHECK constrains it to an object; the stored value is
              // the same schema this cast names.
              lineage: existing.lineage as DocumentVersionLineage,
            }
          : {}),
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
    const alignment = baseIsCurrent
      ? null
      : alignMergeDocuments(baseDocument, currentDocument)
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
      const recorder = createLineageRecorder(currentDocument.model)
      applyDocumentEdits(
        currentDocument,
        // The client addresses its base version; the current version has
        // reallocated positional ids, so the batch is rewritten to current
        // addresses before it is applied. Applying base ids directly could
        // write a run a collaborator inserted there.
        alignment
          ? remapMergeOperations(input.operations, alignment)
          : input.operations,
        input.trackChanges
          ? {
              author: input.userName?.trim() || input.userId,
              date: (input.now?.() ?? new Date()).toISOString(),
            }
          : undefined,
        recorder,
      )
      const canonicalParagraphIds =
        canonicaliseParagraphIdentities(currentDocument)
      const currentLineage = buildVersionLineage({
        recorder,
        model: currentDocument.model,
        canonicalParagraphIds,
        baseVersionId: input.baseVersionId,
        versionId: '',
        // Same tracked-run caveat as the direct edit path.
        runAddressesReliable: !input.trackChanges,
      })
      // A merge that reconciled the client's operations onto a newer current
      // version records its lineage against that current version. Re-express
      // it against the client's base so the client's history stays
      // translatable; the correspondence comes from persisted paragraph ids
      // and the verified run skeleton, never from positions or text.
      const built = alignment
        ? retargetLineageToBaseVersion({
            lineage: currentLineage,
            currentToBaseParagraph: invertMap(alignment.baseToCurrentParagraph),
            currentToBaseRun: invertMap(alignment.baseToCurrentRun),
            baseVersionId: input.baseVersionId,
          })
        : currentLineage
      const { versionId: _versionId, ...lineageInput } = built
      const persistedLineage: Omit<DocumentVersionLineage, 'versionId'> =
        lineageInput
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
        lineage: persistedLineage,
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
        lineage: { ...lineageInput, versionId: committed.versionId },
      }
    } catch (error) {
      if (error instanceof OoxmlError) throw new DocumentEditInvalidError()
      throw new DocumentEditStoreError()
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

function invertMap(map: ReadonlyMap<string, string>) {
  return new Map([...map].map(([from, to]) => [to, from] as const))
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
