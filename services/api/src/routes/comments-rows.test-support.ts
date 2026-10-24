export interface StoredComment {
  id: string
  organisationId: string
  matterId: string
  documentId: string
  anchorVersionId: string | null
  paragraphId: string
  endParagraphId: string | null
  startOffset: number
  endOffset: number
  body: string
  authorId: string
  authorName: string
  clientKey: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface StoredReply {
  id: string
  organisationId: string
  matterId: string
  documentId: string
  commentId: string | null
  importedCommentId: string | null
  importedParentFingerprint: string | null
  body: string
  authorId: string
  authorName: string
  clientKey: string | null
  createdAt: string
}

export function commentRow(comment: StoredComment) {
  return {
    id: comment.id,
    document_id: comment.documentId,
    anchor_version_id: comment.anchorVersionId,
    paragraph_id: comment.paragraphId,
    end_paragraph_id: comment.endParagraphId,
    start_offset: comment.startOffset,
    end_offset: comment.endOffset,
    body: comment.body,
    author_id: comment.authorId,
    author_name: comment.authorName,
    resolved_at: comment.resolvedAt,
    resolved_by: comment.resolvedBy,
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
  }
}

export function replyRow(reply: StoredReply) {
  return {
    id: reply.id,
    comment_id: reply.commentId,
    imported_comment_id: reply.importedCommentId,
    imported_parent_fingerprint: reply.importedParentFingerprint,
    body: reply.body,
    author_id: reply.authorId,
    author_name: reply.authorName,
    created_at: reply.createdAt,
  }
}
