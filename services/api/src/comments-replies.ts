import type { Pool } from 'pg'
import {
  CommentsDatabaseError,
  commentTransaction,
  type CreateReplyResult,
  lockCurrentDocument,
  mapReply,
  replyColumns,
  type ReplyRow,
} from './comments-db'
import { appendAuditLog } from './database'
import { lockMatterForEdit } from './matter-lock'

const IMPORTED_PARENT_FINGERPRINT = /^[0-9a-f]{64}$/u

export async function createDocumentCommentReply(
  pool: Pool,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    currentVersionId: string
    /** Product thread head; mutually exclusive with importedCommentId. */
    commentId?: string
    /** Imported `ooxml-<w:id>` thread head the route resolved in the model. */
    importedCommentId?: string
    /**
     * SHA-256 of the imported head's served identity, required whenever
     * `importedCommentId` is set, so a later version that reuses the `w:id`
     * for a different thread cannot silently inherit this reply.
     */
    importedParentFingerprint?: string
    body: string
    authorId: string
    authorName: string
    clientKey?: string
    requestId: string
  },
): Promise<CreateReplyResult | null> {
  if (
    (input.commentId === undefined) ===
    (input.importedCommentId === undefined)
  ) {
    throw new CommentsDatabaseError()
  }
  if (
    input.importedCommentId !== undefined &&
    !IMPORTED_PARENT_FINGERPRINT.test(input.importedParentFingerprint ?? '')
  ) {
    throw new CommentsDatabaseError()
  }
  if (
    input.commentId !== undefined &&
    input.importedParentFingerprint !== undefined
  ) {
    throw new CommentsDatabaseError()
  }
  return commentTransaction(pool, async (client) => {
    if (
      !(await lockMatterForEdit(client, {
        organisationId: input.organisationId,
        matterId: input.matterId,
        userId: input.authorId,
      }))
    ) {
      return null
    }
    if (
      !(await lockCurrentDocument(client, {
        ...input,
        anchorVersionId: input.currentVersionId,
      }))
    ) {
      return null
    }
    if (input.commentId !== undefined) {
      // The scoped composite foreign key covers row integrity; the explicit
      // probe keeps a missing or cross-scope parent a clean null rather than
      // a constraint violation.
      const parent = await client.query(
        `
          select id
          from document_comments
          where id = $1
            and document_id = $2
            and matter_id = $3
            and organisation_id = $4
        `,
        [
          input.commentId,
          input.documentId,
          input.matterId,
          input.organisationId,
        ],
      )
      if (parent.rows.length === 0) return null
    }

    const inserted = await client.query<ReplyRow>(
      `
        insert into document_comment_replies (
          organisation_id, matter_id, document_id,
          comment_id, imported_comment_id, imported_parent_fingerprint,
          body, author_id, author_name, client_key, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
        on conflict (document_id, author_id, client_key)
          where client_key is not null
          do nothing
        returning ${replyColumns}
      `,
      [
        input.organisationId,
        input.matterId,
        input.documentId,
        input.commentId ?? null,
        input.importedCommentId ?? null,
        input.importedParentFingerprint ?? null,
        input.body,
        input.authorId,
        input.authorName,
        input.clientKey ?? null,
      ],
    )
    const row = inserted.rows[0]
    if (row === undefined) {
      // Client-key replay: the stored row must carry the same payload —
      // parent, parent's imported fingerprint, and body — or the key was
      // reused for a different reply and the request conflicts.
      const stored = (
        await client.query<ReplyRow>(
          `
            select ${replyColumns}
            from document_comment_replies
            where document_id = $1
              and author_id = $2
              and client_key = $3
          `,
          [input.documentId, input.authorId, input.clientKey ?? ''],
        )
      ).rows[0]
      if (!stored) throw new CommentsDatabaseError()
      if (!sameReplyPayload(stored, input)) return { status: 'conflict' }
      return { status: 'replayed', reply: mapReply(stored) }
    }
    const reply = mapReply(row)

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.authorId,
      entityType: 'document_comment',
      entityId: input.commentId ?? input.importedCommentId ?? reply.id,
      action: 'document.comment_reply',
      metadata: {
        documentId: input.documentId,
        matterId: input.matterId,
        replyId: reply.id,
      },
      requestId: input.requestId,
    })
    return { status: 'created', reply }
  })
}

function sameReplyPayload(
  row: ReplyRow,
  input: {
    commentId?: string
    importedCommentId?: string
    importedParentFingerprint?: string
    body: string
  },
) {
  return (
    row.body === input.body &&
    row.comment_id === (input.commentId ?? null) &&
    row.imported_comment_id === (input.importedCommentId ?? null) &&
    row.imported_parent_fingerprint ===
      (input.importedParentFingerprint ?? null)
  )
}
