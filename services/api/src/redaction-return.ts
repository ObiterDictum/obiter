import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { parseDocx } from '@obiter/ooxml'
import {
  commitPreparedVersion,
  DocumentEditStoreError,
  isCanonicalReadyDocxVersion,
  lockCurrentAndBaseVersions,
  rollback,
} from './document-version-commit'
import { selectMutationRun } from './redaction-database'
import type { StorageService } from './storage'

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type RedactionReturnResult =
  | {
      status: 'returned' | 'already_returned'
      documentId: string
      versionId: string
      versionNumber: number
    }
  | { status: 'stale' }
  | { status: 'unavailable' }
  | { status: 'not_found' }

export async function returnRedactionToDocument(
  pool: Pool,
  storage: StorageService,
  input: {
    organisationId: string
    userId: string
    runId: string
    baseVersionId: string
    requestId: string
  },
): Promise<RedactionReturnResult> {
  if (!storage.readBinary) throw new DocumentEditStoreError()

  let client
  try {
    client = await pool.connect()
  } catch {
    throw new DocumentEditStoreError()
  }

  try {
    await client.query('begin')
    const run = await selectMutationRun(client, {
      organisationId: input.organisationId,
      userId: input.userId,
      runId: input.runId,
      includeDeleted: false,
    })
    if (!run) {
      await client.query('rollback')
      return { status: 'not_found' }
    }

    if (run.returnedDocumentVersionId) {
      const existing = await client.query<{
        id: string
        version_number: number
        matter_document_id: string
      }>(
        `select id, version_number, matter_document_id from document_versions
         where id = $1 and organisation_id = $2`,
        [run.returnedDocumentVersionId, run.organisationId],
      )
      const row = existing.rows[0]
      await client.query('rollback')
      if (!row) return { status: 'unavailable' }
      return {
        status: 'already_returned',
        documentId: row.matter_document_id,
        versionId: row.id,
        versionNumber: row.version_number,
      }
    }

    const outputSha256 = run.summary.outputSha256
    if (
      run.status !== 'finalized' ||
      run.replacementRunId ||
      !run.matterId ||
      !run.documentId ||
      !run.documentVersionId ||
      !run.outputId ||
      run.summary.outputMimeType !== DOCX_MIME ||
      typeof outputSha256 !== 'string' ||
      outputSha256.length === 0
    ) {
      await client.query('rollback')
      return { status: 'unavailable' }
    }

    const outputRow = await client.query<{ object_key: string }>(
      `select object_key from outputs
       where id = $1 and organisation_id = $2 and matter_id is not distinct from $3
         and output_type = 'redaction_output' and status = 'ready'`,
      [run.outputId, run.organisationId, run.matterId],
    )
    const objectKey = outputRow.rows[0]?.object_key
    if (!objectKey) {
      await client.query('rollback')
      return { status: 'unavailable' }
    }

    let output: Buffer
    try {
      output = await storage.readBinary(objectKey)
    } catch {
      await client.query('rollback')
      return { status: 'unavailable' }
    }
    const storedSha256 = createHash('sha256').update(output).digest('hex')
    if (storedSha256 !== outputSha256) {
      await client.query('rollback')
      return { status: 'unavailable' }
    }

    try {
      await parseDocx(Uint8Array.from(output))
    } catch {
      await client.query('rollback')
      return { status: 'unavailable' }
    }

    const scope = {
      organisationId: run.organisationId,
      matterId: run.matterId,
      documentId: run.documentId,
    }
    const locked = await lockCurrentAndBaseVersions(client, {
      ...scope,
      baseVersionId: input.baseVersionId,
    })
    if (!locked?.current || !locked.base) {
      await client.query('rollback')
      return { status: 'not_found' }
    }
    if (
      locked.current.id !== input.baseVersionId ||
      locked.base.id !== input.baseVersionId ||
      locked.current.id !== run.documentVersionId
    ) {
      await client.query('rollback')
      return { status: 'stale' }
    }
    if (!isCanonicalReadyDocxVersion(locked.current, scope)) {
      await client.query('rollback')
      return { status: 'not_found' }
    }

    const runId = run.id
    const result = await commitPreparedVersion(client, storage, {
      ...scope,
      userId: input.userId,
      requestId: input.requestId,
      expectedCurrentVersionId: locked.current.id,
      parentVersion: locked.current,
      preparedBytes: Uint8Array.from(output),
      lineage: null,
      audit: {
        action: 'redaction.return_to_document',
        metadata: (versionId) => ({
          runId,
          outputId: run.outputId,
          sourceVersionId: run.documentVersionId,
          returnedVersionId: versionId,
          outputSha256,
        }),
      },
      onCommitted: async (tx, versionId) => {
        await tx.query(
          `update redaction_runs
           set returned_document_version_id = $3, updated_at = now()
           where id = $1 and organisation_id = $2
             and returned_document_version_id is null`,
          [runId, run.organisationId, versionId],
        )
      },
    })
    if (result.status !== 'created') return { status: 'stale' }
    return {
      status: 'returned',
      documentId: run.documentId,
      versionId: result.versionId,
      versionNumber: result.versionNumber,
    }
  } catch (error) {
    await rollback(client)
    if (error instanceof DocumentEditStoreError) throw error
    throw new DocumentEditStoreError()
  } finally {
    client.release()
  }
}
