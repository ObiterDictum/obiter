import type { Pool, PoolClient } from 'pg'
import {
  documentCommentRecordSchema,
  type DocumentCommentAnchor,
  type DocumentCommentRecord,
} from '@obiter/contracts'

export type CommentRow = {
  id: string
  document_id: string
  anchor_version_id: string | null
  paragraph_id: string
  end_paragraph_id: string | null
  start_offset: number
  end_offset: number
  body: string
  author_id: string
  author_name: string
  resolved_at: Date | string | null
  resolved_by: string | null
  created_at: Date | string
  updated_at: Date | string
}

export type ListedCommentRow = Partial<CommentRow> & {
  active_document_id: string
}

export type ReplyRow = {
  id: string
  comment_id: string | null
  imported_comment_id: string | null
  imported_parent_fingerprint: string | null
  body: string
  author_id: string
  author_name: string
  created_at: Date | string
}

/**
 * A stored product-authored reply. Exactly one of `commentId` (a product
 * thread head) and `importedCommentId` (a package-carried `ooxml-<w:id>`
 * thread head) is set; replies to an imported thread keep working when the
 * version's comments part changes, and surface as orphaned when it does not.
 * `importedParentFingerprint` pins the head the reply was written against so
 * a later version that reuses the same `w:id` for a different thread cannot
 * silently inherit it; rows written before the fingerprint existed carry
 * null and do not reattach.
 */
export type DocumentCommentReplyRecord = {
  id: string
  commentId: string | null
  importedCommentId: string | null
  importedParentFingerprint: string | null
  body: string
  author: { id: string; name: string }
  createdAt: string
}

export type ListedDocumentComments = {
  comments: DocumentCommentRecord[]
  replies: DocumentCommentReplyRecord[]
}

/**
 * A client-key create resolves to one of three outcomes: the row was
 * inserted, the key replayed a stored row whose payload matches
 * (idempotent retry), or the key was reused with a different payload —
 * reported as a typed conflict rather than silently served the wrong row.
 */
export type CreateCommentResult =
  | { status: 'created' | 'replayed'; comment: DocumentCommentRecord }
  | { status: 'conflict' }

export type CreateReplyResult =
  | { status: 'created' | 'replayed'; reply: DocumentCommentReplyRecord }
  | { status: 'conflict' }

/**
 * A resolution transition: 'applied' changed the stored state, 'unchanged'
 * means the comment already held the requested state for an authorised
 * caller, and 'forbidden' means the comment exists in scope but the actor is
 * neither its author nor an organisation manager. `replies` is read inside
 * the same transaction before commit, so the route renders the state it
 * actually committed rather than a post-commit re-read.
 */
export type ResolutionResult =
  | {
      status: 'applied' | 'unchanged'
      comment: DocumentCommentRecord
      replies: DocumentCommentReplyRecord[]
    }
  | { status: 'forbidden' }
  | { status: 'not_found' }

export class CommentsDatabaseError extends Error {
  constructor() {
    super('The comment operation could not be completed.')
    this.name = new.target.name
  }
}

export const commentColumns = `
  id, document_id, anchor_version_id, paragraph_id, end_paragraph_id,
  start_offset, end_offset,
  body, author_id, author_name, resolved_at, resolved_by, created_at, updated_at
`

export const replyColumns = `
  id, comment_id, imported_comment_id, imported_parent_fingerprint,
  body, author_id, author_name, created_at
`

export function lockCurrentDocument(
  client: PoolClient,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    anchorVersionId: string
  },
) {
  return client
    .query<{ id: string }>(
      `
        select document.id
        from matter_documents document
        join document_versions version
          on version.id = document.current_version_id
          and version.matter_document_id = document.id
          and version.matter_id = document.matter_id
          and version.organisation_id = document.organisation_id
        where document.id = $1
          and document.matter_id = $2
          and document.organisation_id = $3
          and document.current_version_id = $4
          and document.deleted_at is null
          and version.document_status = 'ready'
          and version.file_type = 'docx'
        for update of document
      `,
      [
        input.documentId,
        input.matterId,
        input.organisationId,
        input.anchorVersionId,
      ],
    )
    .then((result) => result.rows.length === 1)
}

export async function commentTransaction<Result>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<Result>,
) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const result = await operation(client)
    if (result === null) {
      await client.query('rollback')
      return result
    }
    await client.query('commit')
    return result
  } catch {
    await client.query('rollback')
    throw new CommentsDatabaseError()
  } finally {
    client.release()
  }
}

export function crossParagraphEndId(anchor: DocumentCommentAnchor) {
  return anchor.endParagraphId !== undefined &&
    anchor.endParagraphId !== anchor.paragraphId
    ? anchor.endParagraphId
    : null
}

export function mapComment(row: CommentRow): DocumentCommentRecord {
  return documentCommentRecordSchema.parse({
    id: row.id,
    documentId: row.document_id,
    anchorVersionId: row.anchor_version_id,
    anchor: {
      paragraphId: row.paragraph_id,
      startOffset: row.start_offset,
      endOffset: row.end_offset,
      ...(row.end_paragraph_id !== null
        ? { endParagraphId: row.end_paragraph_id }
        : {}),
    },
    body: row.body,
    author: { id: row.author_id, name: row.author_name },
    resolvedAt: timestamp(row.resolved_at),
    resolvedBy: row.resolved_by,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  })
}

export function mapReply(row: ReplyRow): DocumentCommentReplyRecord {
  return {
    id: row.id,
    commentId: row.comment_id,
    importedCommentId: row.imported_comment_id,
    importedParentFingerprint: row.imported_parent_fingerprint,
    body: row.body,
    author: { id: row.author_id, name: row.author_name },
    createdAt: timestamp(row.created_at),
  }
}

export function timestamp(value: Date | string): string
export function timestamp(value: Date | string | null): string | null
export function timestamp(value: Date | string | null) {
  return value instanceof Date ? value.toISOString() : value
}

export function requireCompleteRow(row: ListedCommentRow): CommentRow {
  if (
    !row.id ||
    !row.document_id ||
    row.anchor_version_id === undefined ||
    !row.paragraph_id ||
    row.end_paragraph_id === undefined ||
    row.start_offset === undefined ||
    row.end_offset === undefined ||
    row.body === undefined ||
    !row.author_id ||
    !row.author_name ||
    row.resolved_at === undefined ||
    row.resolved_by === undefined ||
    row.created_at === undefined ||
    row.updated_at === undefined
  ) {
    throw new CommentsDatabaseError()
  }
  return {
    id: row.id,
    document_id: row.document_id,
    anchor_version_id: row.anchor_version_id,
    paragraph_id: row.paragraph_id,
    end_paragraph_id: row.end_paragraph_id,
    start_offset: row.start_offset,
    end_offset: row.end_offset,
    body: row.body,
    author_id: row.author_id,
    author_name: row.author_name,
    resolved_at: row.resolved_at,
    resolved_by: row.resolved_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}
