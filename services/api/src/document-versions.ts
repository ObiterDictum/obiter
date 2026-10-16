import type { Pool } from 'pg'
import type {
  DocumentEditOperation,
  DocumentMarkingsWire,
  DocumentTrackedChangeDecisionRequest,
  DocumentVersionLineage,
} from '@obiter/contracts'
import {
  OoxmlError,
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  buildVersionLineage,
  canonicaliseParagraphIdentities,
  createLineageRecorder,
  parseDocx,
  serialiseDocx,
  writeDocumentMarkings,
} from '@obiter/ooxml'
import type { AuditRecordInput, DocumentVersionRecord } from './database'
import { lockMatterForEdit } from './matter-lock'
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
  removeParagraphIds?: readonly string[]
}

type MarkingsVersionInput = VersionMutationInput & {
  markings: DocumentMarkingsWire
}

type MutationAudit = {
  action: Extract<
    AuditRecordInput['action'],
    | 'document.edit'
    | 'document.markings'
    | 'document.tracked_change_accept'
    | 'document.tracked_change_reject'
  >
  metadata: (versionId: string) => AuditRecordInput['metadata']
}

export type CreateEditedVersionResult =
  | {
      status: 'created'
      versionId: string
      versionNumber: number
      lineage?: DocumentVersionLineage
    }
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
  const { editedBytes, lineage } = await prepareEditedSource(storage, input)
  return createPreparedVersion(
    pool,
    storage,
    input,
    editedBytes,
    {
      action: 'document.edit',
      metadata: (versionId) => ({
        baseVersionId: input.baseVersionId,
        newVersionId: versionId,
        operationCount: input.operations.length,
      }),
    },
    lineage,
  )
}

async function prepareEditedSource(
  storage: StorageService,
  input: EditedVersionInput,
) {
  validateBaseVersion(input)
  const document = await readSourceDocument(storage, input.baseVersion)
  const recorder = createLineageRecorder(document.model)
  try {
    applyDocumentEdits(
      document,
      input.operations,
      input.trackChanges
        ? {
            author: input.userName?.trim() || input.userId,
            date: (input.now?.() ?? new Date()).toISOString(),
          }
        : undefined,
      recorder,
    )
  } catch (error) {
    if (error instanceof OoxmlError) throw new DocumentEditInvalidError()
    throw new DocumentEditStoreError()
  }
  const canonicalParagraphIds = canonicaliseParagraphIdentities(document)
  let editedBytes: Uint8Array
  try {
    editedBytes = await serialiseDocx(document)
  } catch {
    throw new DocumentEditStoreError()
  }
  const built = buildVersionLineage({
    recorder,
    model: document.model,
    canonicalParagraphIds,
    baseVersionId: input.baseVersionId,
    versionId: '',
    // Tracked wrappers reparse to a different run list, so no run address in a
    // tracked version is trustworthy. The client blocks a run-keyed reversal.
    runAddressesReliable: !input.trackChanges,
  })
  const { versionId: _versionId, ...lineage } = built
  return { editedBytes, lineage }
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
      input.removeParagraphIds ?? [],
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
      ...(input.removeParagraphIds?.length
        ? { removedParagraphIds: [...input.removeParagraphIds] }
        : {}),
    }),
  })
}

/**
 * Markings are metadata-only, but they still ride the immutable-version
 * pipeline: a new classification commits a new version, so the audit trail
 * can say exactly which revision was marked Privileged or Without prejudice.
 * The lineage is the identity map — paragraphs and runs are untouched, so a
 * restore anchored on the previous version still resolves.
 */
export async function createMarkingsVersion(
  pool: Pool,
  storage: StorageService,
  input: MarkingsVersionInput,
): Promise<CreateEditedVersionResult> {
  let lineage: Omit<DocumentVersionLineage, 'versionId'> | undefined
  const editedBytes = await prepareSource(storage, input, (document) => {
    writeDocumentMarkings(document, input.markings)
    const recorder = createLineageRecorder(document.model)
    const canonicalParagraphIds = canonicaliseParagraphIdentities(document)
    const { versionId: _versionId, ...built } = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds,
      baseVersionId: input.baseVersionId,
      versionId: '',
      runAddressesReliable: true,
    })
    lineage = built
  })
  return createPreparedVersion(
    pool,
    storage,
    input,
    editedBytes,
    {
      action: 'document.markings',
      metadata: (versionId) => ({
        baseVersionId: input.baseVersionId,
        newVersionId: versionId,
        documentKind: input.markings.documentKind,
        draft: input.markings.draft,
        privileged: input.markings.privileged,
        withoutPrejudice: input.markings.withoutPrejudice,
      }),
    },
    lineage ?? null,
  )
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
  lineage?: Omit<DocumentVersionLineage, 'versionId'> | null,
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
    // Matter before document: the commit-time authorization re-check shares the
    // revocation lock, so a grant withdrawn while this write was queued cannot
    // be outrun by the document lock. See matter-lock.ts.
    if (!(await lockMatterForEdit(client, input))) {
      await client.query('rollback')
      return { status: 'not_found' }
    }
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
    const result = await commitPreparedVersion(client, storage, {
      organisationId: input.organisationId,
      matterId: input.matterId,
      documentId: input.documentId,
      userId: input.userId,
      requestId: input.requestId,
      expectedCurrentVersionId: locked.current.id,
      parentVersion: locked.current,
      preparedBytes: editedBytes,
      lineage: lineage ?? null,
      audit,
    })
    if (result.status === 'created' && lineage) {
      return {
        ...result,
        lineage: { ...lineage, versionId: result.versionId },
      }
    }
    return result
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
