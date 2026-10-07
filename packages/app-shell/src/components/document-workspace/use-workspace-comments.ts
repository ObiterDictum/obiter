import type {
  DocumentCommentAnchor,
  DocumentCommentListResponse,
} from '@obiter/contracts'

import {
  useCreateDocumentComment,
  useReopenDocumentComment,
  useReplyDocumentComment,
  useResolveDocumentComment,
} from '../../document-workspace-api'
import { refocusCaret, refocusCaretBeforeFlight } from './document-actions'
import { mutationError } from './workspace-chrome'

/**
 * The comments side panel's wiring: the mutations and the props the panel
 * consumes. A new comment's anchor is the live selection's real range or the
 * caret's insertion point, never widened to a paragraph; each action hands
 * focus back to the caret first because a control disabled mid-flight would
 * drop focus to the body.
 */
export function useWorkspaceComments({
  documentId,
  listed,
  commentTarget,
  currentUserId,
  canModerate,
  revealCommentAnchor,
}: {
  documentId: string
  listed: DocumentCommentListResponse | undefined
  commentTarget: DocumentCommentAnchor | null
  currentUserId: string | undefined
  canModerate: boolean
  revealCommentAnchor: (anchor: DocumentCommentAnchor) => void
}) {
  const createComment = useCreateDocumentComment(documentId)
  const replyComment = useReplyDocumentComment(documentId)
  const resolveComment = useResolveDocumentComment(documentId)
  const reopenComment = useReopenDocumentComment(documentId)
  return {
    threadCount:
      (listed?.comments.length ?? 0) + (listed?.importedComments.length ?? 0),
    props: {
      comments: listed?.comments ?? [],
      importedComments: listed?.importedComments ?? [],
      orphanedReplies: listed?.orphanedReplies ?? [],
      commentTarget,
      currentUserId,
      canModerate,
      commentsPending:
        createComment.isPending ||
        replyComment.isPending ||
        resolveComment.isPending ||
        reopenComment.isPending,
      commentsError: mutationError(
        createComment.error ??
          replyComment.error ??
          resolveComment.error ??
          reopenComment.error,
      ),
      onCreateComment: (body: string) => {
        refocusCaret()
        if (commentTarget) createComment.mutate({ body, anchor: commentTarget })
      },
      onReplyComment: (input: { parentId: string; body: string }) => {
        refocusCaretBeforeFlight()
        replyComment.mutate({
          commentId: input.parentId,
          reply: { body: input.body },
        })
      },
      onResolveComment: (commentId: string) => {
        refocusCaretBeforeFlight()
        resolveComment.mutate(commentId)
      },
      onReopenComment: (commentId: string) => {
        refocusCaretBeforeFlight()
        reopenComment.mutate(commentId)
      },
      onRevealCommentAnchor: revealCommentAnchor,
    },
  }
}
