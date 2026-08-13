import type { Pool } from 'pg'
import { parseDocx, serialiseDocxWithComments } from '@obiter/ooxml'
import { CommentsDatabaseError, listDocumentComments } from './comments-db'
import {
  appendAuditLog,
  createDocumentObjectKey,
  type DocumentVersionRecord,
} from './database'
import { DocumentArtifactStoreError } from './document-artifact-store'
import type { StorageService } from './storage'

export const DOCUMENT_EXPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type ExportVersion = Pick<
  DocumentVersionRecord,
  | 'id'
  | 'organisationId'
  | 'matterId'
  | 'matterDocumentId'
  | 'objectKey'
  | 'filename'
>

export class DocumentExportError extends DocumentArtifactStoreError {
  constructor() {
    super('The document could not be exported.')
  }
}

export type DocumentExportResult =
  | { status: 'not_found' }
  | { status: 'ok'; bytes: Uint8Array; filename: string }

export async function exportDocumentDocx(
  pool: Pool,
  storage: StorageService,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    version: ExportVersion
    userId: string
    requestId: string
  },
): Promise<DocumentExportResult> {
  const comments = await listComments(pool, input)
  if (comments === null) return { status: 'not_found' }

  const expectedSourceKey = createDocumentObjectKey({
    organisationId: input.version.organisationId,
    matterId: input.version.matterId,
    documentId: input.version.matterDocumentId,
    versionId: input.version.id,
  })
  if (input.version.objectKey !== expectedSourceKey) {
    throw new DocumentExportError()
  }
  if (!storage.readBinary) throw new DocumentExportError()

  let source: Buffer
  try {
    source = await storage.readBinary(expectedSourceKey)
  } catch {
    throw new DocumentExportError()
  }

  const bytes =
    comments.length === 0
      ? Uint8Array.from(source)
      : await embedComments(source, comments)

  await appendAuditLog(pool, {
    organisationId: input.organisationId,
    userId: input.userId,
    entityType: 'document',
    entityId: input.documentId,
    action: 'document.export',
    metadata: {
      matterId: input.matterId,
      versionId: input.version.id,
      commentCount: comments.length,
    },
    requestId: input.requestId,
  })

  return {
    status: 'ok',
    bytes,
    filename: documentExportFilename(input.version.filename),
  }
}

export function documentExportFilename(filename: string) {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'))
  const leaf = slash === -1 ? filename : filename.slice(slash + 1)
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f"/\\]/gu, '').trim()
  const base = cleaned.length > 0 ? cleaned : 'document'
  const withExt = /\.docx$/iu.test(base) ? base : `${base}.docx`
  return withExt.length <= 200 ? withExt : `${withExt.slice(0, 196)}.docx`
}

export function documentExportContentDisposition(filename: string) {
  const ascii = filename.replace(/[^\u0020-\u007e]/gu, '_').replace(/"/gu, '')
  return `attachment; filename="${ascii}"`
}

async function listComments(
  pool: Pool,
  input: { organisationId: string; matterId: string; documentId: string },
) {
  try {
    return await listDocumentComments(pool, input)
  } catch (error) {
    if (error instanceof CommentsDatabaseError) throw new DocumentExportError()
    throw error
  }
}

async function embedComments(
  source: Buffer,
  comments: NonNullable<Awaited<ReturnType<typeof listDocumentComments>>>,
) {
  try {
    const document = await parseDocx(Uint8Array.from(source))
    return await serialiseDocxWithComments(document, comments)
  } catch {
    throw new DocumentExportError()
  }
}
