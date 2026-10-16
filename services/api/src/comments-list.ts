import type { Pool } from 'pg'
import {
  CommentsDatabaseError,
  type ListedCommentRow,
  type ListedDocumentComments,
  mapComment,
  mapReply,
  replyColumns,
  type ReplyRow,
  requireCompleteRow,
} from './comments-db'

export async function listDocumentComments(
  pool: Pool,
  input: { organisationId: string; matterId: string; documentId: string },
): Promise<ListedDocumentComments | null> {
  try {
    const result = await pool.query<ListedCommentRow>(
      `
        select
          document.id as active_document_id,
          comment.id, comment.document_id, comment.anchor_version_id,
          comment.paragraph_id, comment.end_paragraph_id,
          comment.start_offset, comment.end_offset,
          comment.body, comment.author_id, comment.author_name,
          comment.resolved_at, comment.resolved_by,
          comment.created_at, comment.updated_at
        from matter_documents document
        left join document_comments comment
          on comment.document_id = document.id
          and comment.matter_id = document.matter_id
          and comment.organisation_id = document.organisation_id
        where document.id = $1
          and document.matter_id = $2
          and document.organisation_id = $3
          and document.deleted_at is null
        order by comment.created_at, comment.id
      `,
      [input.documentId, input.matterId, input.organisationId],
    )
    if (result.rows.length === 0) return null

    const replies = await pool.query<ReplyRow>(
      `
        select ${replyColumns}
        from document_comment_replies
        where document_id = $1
          and matter_id = $2
          and organisation_id = $3
        order by created_at, id
      `,
      [input.documentId, input.matterId, input.organisationId],
    )

    return {
      comments: result.rows.flatMap((row) =>
        row.id ? [mapComment(requireCompleteRow(row))] : [],
      ),
      replies: replies.rows.map(mapReply),
    }
  } catch (error) {
    if (error instanceof CommentsDatabaseError) throw error
    throw new CommentsDatabaseError()
  }
}
