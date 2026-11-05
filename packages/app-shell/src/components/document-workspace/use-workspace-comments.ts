import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../../api'
import { workspaceKeys } from '../../document-workspace-queries'
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
import { queryLoad } from './document-right-slot'

type CommentIntent =
  | { documentId: string; anchor: DocumentCommentAnchor; body: string }
  | { documentId: string; parentId: string; body: string }

export type WorkspaceCommentsPanelProps = ReturnType<
  typeof useWorkspaceComments
>['props']

function commentThreadCount(listed: DocumentCommentListResponse | undefined) {
  return (listed?.comments.length ?? 0) + (listed?.importedComments.length ?? 0)
}

export function useWorkspaceComments({
  documentId,
  query,
  commentTarget,
  currentUserId,
  canModerate,
  revealCommentAnchor,
}: {
  documentId: string
  query: {
    data: DocumentCommentListResponse | undefined
    isError: boolean
    error: unknown
  }
  commentTarget: DocumentCommentAnchor | null
  currentUserId: string | undefined
  canModerate: boolean
  revealCommentAnchor: (anchor: DocumentCommentAnchor) => void
}) {
  const client = useQueryClient()
  const deletion = useMutation({
    mutationFn: ({
      commentId,
      action,
    }: {
      commentId: string
      action: 'delete' | 'restore'
    }) =>
      apiFetch(`/api/documents/${documentId}/comments/${commentId}/${action}`, {
        method: 'PATCH',
        body: '{}',
      }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: workspaceKeys.comments(documentId),
      }),
  })
  const listed = query.data
  const createComment = useCreateDocumentComment(documentId)
  const replyComment = useReplyDocumentComment(documentId)
  const resolveComment = useResolveDocumentComment(documentId)
  const reopenComment = useReopenDocumentComment(documentId)

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
    threadCount: commentThreadCount(listed),
    load: queryLoad(query),
    props: {
      comments: listed?.comments ?? [],
      deletableCommentIds: listed?.deletableCommentIds ?? [],
      deletedComments: listed?.deletedComments ?? [],
      onDeleteComment: (commentId: string) =>
        deletion.mutate({ commentId, action: 'delete' }),
      onRestoreComment: (commentId: string) =>
        deletion.mutate({ commentId, action: 'restore' }),
      importedComments: listed?.importedComments ?? [],
      orphanedReplies: listed?.orphanedReplies ?? [],
      commentTarget,
      currentUserId,
      canModerate,
      commentsPending:
        deletion.isPending ||
        createComment.isPending ||
        replyComment.isPending ||
        resolveComment.isPending ||
        reopenComment.isPending,
      commentsError: mutationError(
        deletion.error ??
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
