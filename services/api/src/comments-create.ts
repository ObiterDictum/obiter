import type { Pool } from 'pg'
import type { DocumentCommentAnchor } from '@obiter/contracts'
import {
  commentColumns,
  CommentsDatabaseError,
  commentTransaction,
  type CommentRow,
  type CreateCommentResult,
  crossParagraphEndId,
  lockCurrentDocument,
  mapComment,
} from './comments-db'
import { appendAuditLog } from './audit-log'
import { lockMatterForEdit } from './matter-lock'

export async function createDocumentComment(
  pool: Pool,
  input: {
    organisationId: string
    matterId: string
    documentId: string
    anchorVersionId: string
    anchor: DocumentCommentAnchor
    body: string
    authorId: string
    authorName: string
    clientKey?: string
    requestId: string
  },
): Promise<CreateCommentResult | null> {
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
    if (!(await lockCurrentDocument(client, input))) return null

    const inserted = await client.query<CommentRow>(
      `
        insert into document_comments (
          organisation_id, matter_id, document_id, anchor_version_id,
          paragraph_id, end_paragraph_id, start_offset, end_offset, body,
          author_id, author_name, client_key, created_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
        on conflict (document_id, author_id, client_key)
          where client_key is not null
          do nothing
        returning ${commentColumns}
      `,
      [
        input.organisationId,
        input.matterId,
        input.documentId,
        input.anchorVersionId,
        input.anchor.paragraphId,
        crossParagraphEndId(input.anchor),
        input.anchor.startOffset,
        input.anchor.endOffset,
        input.body,
        input.authorId,
        input.authorName,
        input.clientKey ?? null,
      ],
    )
    const row = inserted.rows[0]
    if (row === undefined) {
      const stored = (
        await client.query<CommentRow>(
          `
            select ${commentColumns}
            from document_comments
            where document_id = $1
              and author_id = $2
              and client_key = $3
              and organisation_id = $4
          `,
          [
            input.documentId,
            input.authorId,
            input.clientKey ?? '',
            input.organisationId,
          ],
        )
      ).rows[0]
      if (!stored) throw new CommentsDatabaseError()
      if (!sameCommentPayload(stored, input)) return { status: 'conflict' }
      return { status: 'replayed', comment: mapComment(stored) }
    }
    const comment = mapComment(row)

    await appendAuditLog(client, {
      organisationId: input.organisationId,
      userId: input.authorId,
      entityType: 'document_comment',
      entityId: comment.id,
      action: 'document.comment_create',
      metadata: {
        documentId: input.documentId,
        matterId: input.matterId,
        anchorVersionId: input.anchorVersionId,
      },
      requestId: input.requestId,
    })
    return { status: 'created', comment }
  })
}

function sameCommentPayload(
  row: CommentRow,
  input: { anchor: DocumentCommentAnchor; body: string },
) {
  return (
    row.body === input.body &&
    row.paragraph_id === input.anchor.paragraphId &&
    row.start_offset === input.anchor.startOffset &&
    row.end_offset === input.anchor.endOffset &&
    row.end_paragraph_id === crossParagraphEndId(input.anchor)
  )
}
