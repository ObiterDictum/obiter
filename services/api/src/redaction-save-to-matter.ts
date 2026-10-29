import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import {
  createDocumentInTransaction,
  getMatter,
  updateDocumentExtraction,
  appendAuditLog,
} from './database'
import {
  extractDocumentContent,
  normaliseFileType,
} from './document-extraction'
import {
  getRedactionOutputKey,
  getRedactionRun,
  selectMutationRun,
  type RedactionRunRecord,
} from './redaction-database'
import type { AuthenticatedOrgUser } from './authz'
import type { StorageService } from './storage'
import { lockMatterForEdit } from './matter-lock'

const PDF_MIME = 'application/pdf'
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type SaveToMatterResult =
  | {
      status: 'saved' | 'already_saved'
      matterId: string
      documentId: string
      versionId: string
      versionNumber: number
    }
  | { status: 'not_found' }
  | { status: 'not_finalized' }
  | { status: 'not_standalone' }
  | { status: 'matter_not_found' }
  | { status: 'unavailable' }

function outputFileType(run: RedactionRunRecord) {
  const mimeType = run.summary.outputMimeType ?? 'text/plain'
  if (mimeType === PDF_MIME) return 'pdf'
  if (mimeType === DOCX_MIME) return 'docx'
  return 'txt'
}

function outputFilename(run: RedactionRunRecord) {
  const recorded = run.summary.outputFilename
  if (recorded) return recorded
  const stem = run.sourceFilename.replace(/\.[^.]+$/u, '') || run.sourceFilename
  const mimeType = run.summary.outputMimeType ?? 'text/plain'
  return `${stem}-redacted.${mimeType === PDF_MIME ? 'pdf' : mimeType === DOCX_MIME ? 'docx' : 'txt'}`
}

/**
 * Files a finalized run's copy into a matter as version 1 of a new document.
 *
 * A run started from pasted text or a standalone upload has no source document
 * to return to, so "save to matter" is the only way its copy becomes a version
 * at all. The bytes are the stored finalized output, re-hashed and compared with
 * the SHA-256 recorded at finalisation, so what lands in the matter is the file
 * the reviewer actually approved. Creating the document goes through the same
 * `createDocument` + extraction + audit path as an upload, and the matter is
 * access-checked for edit: the run's own access does not grant write access to
 * a matter it was never filed in.
 */
export async function saveRedactionOutputToMatter(
  pool: Pool,
  storage: StorageService,
  input: {
    user: AuthenticatedOrgUser
    runId: string
    matterId: string
    requestId: string
  },
): Promise<SaveToMatterResult> {
  const run = await getRedactionRun(pool, input.user, input.runId, 'edit')
  if (!run) return { status: 'not_found' }
  if (run.status !== 'finalized' || run.replacementRunId || !run.outputId)
    return { status: 'not_finalized' }

  // A run linked to a document has a version to return to, so the standalone
  // path refuses rather than forking one run into two records.
  if (run.matterId || run.documentId) return { status: 'not_standalone' }
  if (!(await getMatter(pool, input.user, input.matterId, 'edit')))
    return { status: 'matter_not_found' }

  const filename = outputFilename(run)
  const fileType = normaliseFileType(outputFileType(run))
  if (!fileType) return { status: 'unavailable' }
  let bytes: Buffer = Buffer.alloc(0)
  let storedSha256 = ''
  if (!run.returnedDocumentVersionId) {
    const objectKey = await getRedactionOutputKey(pool, run)
    if (!objectKey || !storage.readBinary) return { status: 'unavailable' }
    try {
      bytes = await storage.readBinary(objectKey)
    } catch {
      return { status: 'unavailable' }
    }
    const recordedSha256 = run.summary.outputSha256
    storedSha256 = createHash('sha256').update(bytes).digest('hex')
    if (
      typeof recordedSha256 === 'string' &&
      recordedSha256.length > 0 &&
      storedSha256 !== recordedSha256
    )
      return { status: 'unavailable' }
  }

  const writtenKeys: string[] = []
  let committed = false
  const client = await pool.connect()
  try {
    await client.query('begin')
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.user.organisationId,
        userId: input.user.id,
        matterId: input.matterId,
      }))
    )
      return { status: 'matter_not_found' }
    const current = await selectMutationRun(client, {
      organisationId: input.user.organisationId,
      userId: input.user.id,
      runId: input.runId,
      includeDeleted: false,
    })
    if (!current) return { status: 'not_found' }
    if (current.returnedDocumentVersionId) {
      const existing = await client.query<{
        id: string
        version_number: number
        matter_document_id: string
        matter_id: string
      }>(
        `select version.id, version.version_number, document.id as matter_document_id,
              document.matter_id
       from document_versions version
       join matter_documents document on document.id = version.matter_document_id
       where version.id = $1 and version.organisation_id = $2`,
        [current.returnedDocumentVersionId, current.organisationId],
      )
      const row = existing.rows[0]
      if (!row) return { status: 'unavailable' }
      if (row.matter_id !== input.matterId)
        return { status: 'matter_not_found' }
      return {
        status: 'already_saved',
        matterId: row.matter_id,
        documentId: row.matter_document_id,
        versionId: row.id,
        versionNumber: row.version_number,
      }
    }

    if (
      current.status !== 'finalized' ||
      current.replacementRunId ||
      current.outputId !== run.outputId
    )
      return { status: 'not_finalized' }
    const created = await createDocumentInTransaction(client, {
      organisationId: run.organisationId,
      matterId: input.matterId,
      userId: input.user.id,
      filename,
      fileType,
      sizeBytes: bytes.byteLength,
      contentSha256: storedSha256,
    })
    if (!created) return { status: 'matter_not_found' }

    const textObjectKey = created.version.objectKey.replace(
      /\/source$/u,
      '/text',
    )
    try {
      if (!storage.writeBinary || !storage.writeText)
        throw new Error('unavailable')
      const extracted = await extractDocumentContent(fileType, bytes)
      writtenKeys.push(created.version.objectKey, textObjectKey)
      if (extracted.layout)
        writtenKeys.push(
          created.version.objectKey.replace(/\/source$/u, '/layout.json'),
        )
      await storage.writeBinary(created.version.objectKey, bytes)
      await storage.writeText(textObjectKey, extracted.text)
      if (extracted.layout)
        await storage.writeText(
          created.version.objectKey.replace(/\/source$/u, '/layout.json'),
          JSON.stringify(extracted.layout),
        )
      await updateDocumentExtraction(client, {
        organisationId: run.organisationId,
        versionId: created.version.id,
        textObjectKey,
      })
    } catch {
      return { status: 'unavailable' }
    }

    await client.query(
      `update redaction_runs
     set returned_document_version_id = $3, updated_at = now()
     where id = $1 and organisation_id = $2 and returned_document_version_id is null`,
      [run.id, run.organisationId, created.version.id],
    )
    await appendAuditLog(client, {
      organisationId: run.organisationId,
      userId: input.user.id,
      entityType: 'document',
      entityId: created.document.id,
      action: 'document.upload',
      metadata: { versionId: created.version.id },
      requestId: input.requestId,
    })
    await appendAuditLog(client, {
      organisationId: run.organisationId,
      userId: input.user.id,
      entityType: 'document_version',
      entityId: created.version.id,
      action: 'document.version_create',
      metadata: { documentId: created.document.id },
      requestId: input.requestId,
    })
    await appendAuditLog(client, {
      organisationId: run.organisationId,
      userId: input.user.id,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction.saved_to_matter',
      metadata: {
        matterId: created.document.matterId,
        documentId: created.document.id,
        versionId: created.version.id,
        outputSha256: storedSha256,
      },
      requestId: input.requestId,
    })

    await client.query('commit')
    committed = true
    return {
      status: 'saved',
      matterId: created.document.matterId,
      documentId: created.document.id,
      versionId: created.version.id,
      versionNumber: created.version.versionNumber,
    }
  } finally {
    try {
      if (!committed) {
        await client.query('rollback')
        const cleaned = await Promise.allSettled(
          writtenKeys.map((key) => storage.delete(key)),
        )
        if (cleaned.some((result) => result.status === 'rejected'))
          console.error('redaction_save_cleanup_failed', { runId: input.runId })
      }
    } finally {
      client.release()
    }
  }
}
