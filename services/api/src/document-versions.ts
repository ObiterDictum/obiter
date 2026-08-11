import type { Pool } from 'pg'
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
import type { AuditRecordInput, DocumentVersionRecord } from './database'
import {
  commitPreparedVersion,
  DocumentEditStoreError,
  isCanonicalReadyDocxVersion,
  lockCurrentAndBaseVersions,
  rollback,
} from './document-version-commit'
import type { StorageService } from './storage'

export { DocumentEditStoreError } from './document-version-commit'

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
    if (
      locked.current?.id !== input.baseVersionId ||
      locked.base?.id !== input.baseVersionId
    ) {
      await client.query('rollback')
      return { status: 'stale' }
    }
    if (
      !isCanonicalReadyDocxVersion(locked.current, input) ||
      !isCanonicalReadyDocxVersion(locked.base, input)
    ) {
      await client.query('rollback')
      return { status: 'not_found' }
    }

    commitStarted = true
    return await commitPreparedVersion(client, storage, {
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      userId: input.userId,
      requestId: input.requestId,
      expectedCurrentVersionId: locked.current.id,
      parentVersion: locked.current,
      preparedBytes: editedBytes,
      audit,
    })
  } catch (error) {
    if (!commitStarted) await rollback(client)
    if (error instanceof DocumentEditStoreError) throw error
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
  if (
    input.baseVersion.id !== input.baseVersionId ||
    !isCanonicalReadyDocxVersion(input.baseVersion, input)
  ) {
    throw new DocumentEditStoreError()
  }
}
