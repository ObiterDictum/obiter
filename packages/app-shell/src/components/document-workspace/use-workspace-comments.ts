import { useRef } from 'react'
import type {
  DocumentCommentAnchor,
  DocumentCommentListResponse,
} from '@obiter/contracts'

import { ApiError } from '../../api'
import {
  useCreateDocumentComment,
  useReopenDocumentComment,
  useReplyDocumentComment,
  useResolveDocumentComment,
} from '../../document-workspace-api'
import { refocusCaret, refocusCaretBeforeFlight } from './document-actions'
import { mutationError } from './workspace-chrome'

/** One unsatisfied write intent: exactly what the author asked to store. */
type CommentIntent =
  | { documentId: string; anchor: DocumentCommentAnchor; body: string }
  | { documentId: string; parentId: string; body: string }

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

  // Idempotency intents, scoped to exactly what the author asked for —
  // document, target and body. Each scope gets one opaque key, minted on
  // first submit, so a retry of an unsatisfied write replays to the stored
  // row instead of duplicating it. Success drops the scope, so a deliberate
  // identical submission afterwards is a new write under a new key; a
  // changed body, anchor, parent or document is a different scope and never
  // reuses the pending key.
  const pendingIntents = useRef(new Map<string, string>())
  const submit = async (
    intent: CommentIntent,
    send: (clientKey: string) => Promise<void>,
  ) => {
    const scope = JSON.stringify(intent)
    let clientKey = pendingIntents.current.get(scope)
    if (clientKey === undefined) {
      clientKey = crypto.randomUUID()
      pendingIntents.current.set(scope, clientKey)
    }
    try {
      await send(clientKey)
      pendingIntents.current.delete(scope)
      return true
    } catch (error) {
      // The mutation error renders through `commentsError`. A typed conflict
      // proves this key already belongs to a different payload, so it is
      // dropped rather than left to reject every resubmit of the draft.
      if (
        error instanceof ApiError &&
        error.code === 'comment_client_key_conflict'
      ) {
        pendingIntents.current.delete(scope)
      }
      return false
    }
  }

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
        if (!commentTarget) return Promise.resolve(false)
        return submit(
          { documentId, anchor: commentTarget, body },
          async (clientKey) => {
            await createComment.mutateAsync({
              body,
              anchor: commentTarget,
              clientKey,
            })
          },
        )
      },
      onReplyComment: (input: { parentId: string; body: string }) => {
        refocusCaretBeforeFlight()
        return submit(
          { documentId, parentId: input.parentId, body: input.body },
          async (clientKey) => {
            await replyComment.mutateAsync({
              commentId: input.parentId,
              reply: { body: input.body, clientKey },
            })
          },
        )
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
