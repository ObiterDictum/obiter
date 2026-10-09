import type { Pool } from 'pg'
import type { DocumentComment, DocumentCommentReply } from '@obiter/contracts'
import {
  buildShareSafeDocx,
  OoxmlError,
  parseDocx,
  serialiseDocxWithComments,
  ShareSafeRefusal,
  validateCommentAnchor,
  type ImportedThreadReply,
} from '@obiter/ooxml'
import {
  CommentsDatabaseError,
  type ListedDocumentComments,
} from './comments-db'
import { listDocumentComments } from './comments-list'
import { importedParentMatches } from './imported-comment-fingerprint'
import {
  appendAuditLog,
  createDocumentObjectKey,
  type DocumentVersionRecord,
} from './database'
import { DocumentArtifactStoreError } from './document-artifact-store'
import {
  DOWNLOAD_FILENAME_MAX_LENGTH,
  downloadContentDisposition,
  safeDownloadFilename,
} from './download-filename'
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

/**
 * The package failed the share-safe policy — tracked changes, hidden text,
 * embedded objects or residue the sanitiser could not verify out. Maps to a
 * 422 `share_safe_export_refused`: a refusal, not a broken export.
 */
export class ShareSafeExportRefusalError extends DocumentExportError {
  readonly refusalReason: string

  constructor(reason: string) {
    super()
    this.name = 'ShareSafeExportRefusalError'
    this.refusalReason = reason
  }
}

export type DocumentExportResult =
  | { status: 'not_found' }
  | {
      status: 'ok'
      bytes: Uint8Array
      filename: string
      skippedCommentCount: number
    }

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
    shareSafe?: boolean
  },
): Promise<DocumentExportResult> {
  // Share-safe export embeds nothing: product comments are exactly the
  // collaboration metadata the mode exists to keep out of the file.
  const listed: ListedDocumentComments | null =
    input.shareSafe === true
      ? { comments: [], replies: [] }
      : await listComments(pool, input)
  if (listed === null) return { status: 'not_found' }

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

  const embedded =
    input.shareSafe === true
      ? await shareSafeBytes(source)
      : listed.comments.length === 0 && listed.replies.length === 0
        ? { bytes: Uint8Array.from(source), skippedCommentCount: 0 }
        : await embedComments(source, listed)

  await appendAuditLog(pool, {
    organisationId: input.organisationId,
    userId: input.userId,
    entityType: 'document',
    entityId: input.documentId,
    action: 'document.export',
    metadata: {
      matterId: input.matterId,
      versionId: input.version.id,
      shareSafe: input.shareSafe === true,
      commentCount: listed.comments.length,
      skippedCommentCount: embedded.skippedCommentCount,
    },
    requestId: input.requestId,
  })

  return {
    status: 'ok',
    bytes: embedded.bytes,
    filename:
      input.shareSafe === true
        ? shareSafeExportFilename(input.version.filename)
        : documentExportFilename(input.version.filename),
    skippedCommentCount: embedded.skippedCommentCount,
  }
}

export function documentExportFilename(filename: string) {
  return safeDownloadFilename(filename, { extension: '.docx' })
}

export function documentExportContentDisposition(filename: string) {
  return downloadContentDisposition(documentExportFilename(filename))
}

const SHARE_SAFE_SUFFIX = '-share-safe.docx'

export function shareSafeExportFilename(filename: string) {
  const safe = safeDownloadFilename(filename, { extension: '.docx' })
  const stem = safe.replace(/\.docx$/iu, '')
  // The suffix is part of the length budget: truncating the assembled name
  // against `.docx` alone would drop `-share-safe` — the marker that tells a
  // recipient which policy produced the file.
  const budget = DOWNLOAD_FILENAME_MAX_LENGTH - SHARE_SAFE_SUFFIX.length
  const trimmed =
    stem.slice(0, Math.max(1, budget)).replace(/[.\s]+$/u, '') || 'document'
  return `${trimmed}${SHARE_SAFE_SUFFIX}`
}

async function shareSafeBytes(source: Buffer) {
  let document
  try {
    document = await parseDocx(Uint8Array.from(source))
  } catch {
    throw new DocumentExportError()
  }
  try {
    return {
      bytes: await buildShareSafeDocx(document),
      skippedCommentCount: 0,
    }
  } catch (error) {
    if (error instanceof ShareSafeRefusal) {
      throw new ShareSafeExportRefusalError(error.message)
    }
    throw new DocumentExportError()
  }
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
  listed: ListedDocumentComments,
): Promise<{ bytes: Uint8Array; skippedCommentCount: number }> {
  try {
    const document = await parseDocx(Uint8Array.from(source))

    const productReplies = new Map<string, DocumentCommentReply[]>()
    const importedReplies: ImportedThreadReply[] = []
    const importedById = new Map(
      document.model.comments.map((entry) => [entry.id, entry]),
    )
    let skippedCommentCount = 0
    for (const record of listed.replies) {
      const reply: DocumentCommentReply = {
        imported: false,
        id: record.id,
        body: record.body,
        author: record.author,
        createdAt: record.createdAt,
      }
      if (record.commentId !== null) {
        const list = productReplies.get(record.commentId)
        if (list) list.push(reply)
        else productReplies.set(record.commentId, [reply])
      } else if (record.importedCommentId !== null) {
        // The head is resolved against this version's own comments part and
        // must match the identity the reply was written against. A head that
        // is absent, carries a different thread under the same w:id, or has
        // no paraId to thread under still exports its reply unanchored so
        // the product-authored text is not dropped — and is counted so the
        // caller knows it did not land on its thread.
        const head = importedById.get(record.importedCommentId)
        const attached =
          head !== undefined &&
          importedParentMatches(record.importedParentFingerprint, head)
            ? head
            : undefined
        const threadable =
          attached !== undefined &&
          attached.ooxmlId !== null &&
          attached.paraId !== null
        if (!threadable) skippedCommentCount += 1
        importedReplies.push({
          ooxmlId: attached?.ooxmlId ?? null,
          paraId: attached?.paraId ?? null,
          reply,
        })
      }
    }

    const resolvable: DocumentComment[] = []
    for (const record of listed.comments) {
      try {
        validateCommentAnchor(document.model, record.anchor)
        resolvable.push({
          ...record,
          replies: productReplies.get(record.id) ?? [],
          anchorResolved: true,
        })
      } catch (error) {
        if (
          error instanceof OoxmlError &&
          error.code === 'comment-anchor-unresolved'
        ) {
          // The comment is skipped; its product replies cannot export either,
          // so they are counted too rather than dropped unaccounted.
          skippedCommentCount +=
            1 + (productReplies.get(record.id)?.length ?? 0)
        } else {
          throw error
        }
      }
    }
    const bytes =
      resolvable.length === 0 && importedReplies.length === 0
        ? Uint8Array.from(source)
        : await serialiseDocxWithComments(document, resolvable, importedReplies)
    return { bytes, skippedCommentCount }
  } catch {
    throw new DocumentExportError()
  }
}
