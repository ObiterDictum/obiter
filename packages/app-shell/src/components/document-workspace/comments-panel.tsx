import { CommentCard } from './comment-card'
import { ImportedCommentCard } from './imported-comment-card'
import { ReplyBody } from './comment-replies'
import type {
  DocumentComment,
  DocumentCommentAnchor,
  DocumentCommentReply,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  EmptyState,
  Input,
  MenuItem,
} from '@obiter/ui'
import { useState, type ReactNode } from 'react'

export function DocumentCommentsPanel({
  comments,
  importedComments,
  orphanedReplies,
  commentTarget,
  canEdit,
  currentUserId,
  canModerate,
  pending,
  error,
  onCreate,
  onReply,
  onResolve,
  onReopen,
  onRevealAnchor,
  deletableCommentIds = [],
  deletedComments = [],
  onDelete,
  onRestore,
}: {
  deletableCommentIds?: string[]
  deletedComments?: {
    id: string
    body: string
    authorName: string
    deletedAt: string
    isReply: boolean
  }[]
  onDelete?: (id: string) => void
  onRestore?: (id: string) => void
  comments: DocumentComment[]
  importedComments: DocumentImportedCommentThread[]
  orphanedReplies: DocumentCommentReply[]
  commentTarget: DocumentCommentAnchor | null
  canEdit: boolean
  currentUserId: string | undefined
  canModerate: boolean
  pending: boolean
  error: string | null
  onCreate: (body: string) => Promise<boolean>
  onReply: (input: { parentId: string; body: string }) => Promise<boolean>
  onResolve: (commentId: string) => void
  onReopen: (commentId: string) => void
  onRevealAnchor: (anchor: DocumentCommentAnchor) => void
}) {
  const [deleting, setDeleting] = useState<{
    id: string
    body: string
    thread: boolean
  } | null>(null)
  const [showDeleted, setShowDeleted] = useState(false)
  const [body, setBody] = useState('')
  const open = comments.filter((comment) => comment.resolvedAt === null)
  const resolved = comments.filter((comment) => comment.resolvedAt !== null)

  const deleteThreadItem = (comment: { id: string; body: string }) =>
    deletableCommentIds.includes(comment.id) ? (
      <MenuItem
        key="thread"
        className="text-danger data-[highlighted]:text-danger"
        disabled={pending}
        onClick={() =>
          setDeleting({ id: comment.id, body: comment.body, thread: true })
        }
      >
        Delete thread
      </MenuItem>
    ) : null

  const deleteReplyItem = (reply: DocumentCommentReply) =>
    !reply.imported && deletableCommentIds.includes(reply.id) ? (
      <MenuItem
        key={reply.id}
        className="text-danger data-[highlighted]:text-danger"
        disabled={pending}
        onClick={() =>
          setDeleting({ id: reply.id, body: reply.body, thread: false })
        }
      >
        Delete reply by {reply.author.name}
      </MenuItem>
    ) : null

  const deleteItems = (items: ReactNode[]) =>
    items.some((item) => item !== null) ? <>{items}</> : null

  const addReason = !commentTarget
    ? 'Select text or place the caret in a paragraph first.'
    : body.trim() === ''
      ? 'Write the comment, then add it.'
      : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-item text-ink">
          {showDeleted ? 'Deleted comments' : 'Comments'}
        </h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowDeleted(!showDeleted)}
        >
          {showDeleted ? 'Active comments' : 'Deleted comments'}
        </Button>
      </div>
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {showDeleted ? (
        <div className="flex flex-col gap-3">
          {deletedComments.length === 0 ? (
            <p className="text-caption text-muted">
              No deleted comments you can restore.
            </p>
          ) : (
            deletedComments.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-col gap-2 border-t border-line pt-3"
              >
                <p className="text-sm font-medium text-ink">
                  {entry.authorName}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                  {entry.body}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 self-start"
                  disabled={pending}
                  onClick={() => onRestore?.(entry.id)}
                >
                  Restore {entry.isReply ? 'reply' : 'thread'}
                </Button>
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <p className="text-caption text-subtle">
            {commentTarget === null
              ? 'Select text or place the caret in a paragraph to comment.'
              : commentTarget.startOffset === commentTarget.endOffset &&
                  !commentTarget.endParagraphId
                ? 'The comment anchors at the caret.'
                : commentTarget.endParagraphId
                  ? 'The comment anchors to the selected text across paragraphs.'
                  : 'The comment anchors to the selected text.'}
          </p>

          {canEdit ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={async (event) => {
                event.preventDefault()
                if (!commentTarget || body.trim() === '') return
                if (await onCreate(body.trim())) setBody('')
              }}
            >
              <Input
                label="New comment"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={
                  commentTarget
                    ? 'Comment on the anchored text'
                    : 'Select text or place the caret first'
                }
                disabled={!commentTarget || pending}
                className="disabled:opacity-60"
              />
              <div className="flex flex-col items-start gap-1">
                <Button
                  type="submit"
                  size="sm"
                  className="disabled:opacity-60"
                  disabled={!commentTarget || body.trim() === '' || pending}
                  loading={pending}
                  aria-describedby="comment-add-reason"
                >
                  Add comment
                </Button>
                {addReason ? (
                  <span
                    id="comment-add-reason"
                    className="text-caption text-subtle"
                  >
                    {addReason}
                  </span>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="text-caption text-muted">
              You can read comments on this matter. Editing requires edit
              access.
            </p>
          )}

          {comments.length === 0 &&
          importedComments.length === 0 &&
          orphanedReplies.length === 0 ? (
            <EmptyState
              title="No comments yet"
              body="Comments stay with this document and are written into exported Word files."
            />
          ) : (
            <>
              {comments.length > 0 ? (
                <ul className="flex flex-col gap-3" aria-label="Comments">
                  {[...open, ...resolved].map((comment) => (
                    <CommentCard
                      key={comment.id}
                      deleteItems={deleteItems([
                        deleteThreadItem(comment),
                        ...comment.replies.map(deleteReplyItem),
                      ])}
                      comment={comment}
                      canEdit={canEdit}
                      mayResolve={
                        canEdit &&
                        (comment.author.id === currentUserId || canModerate)
                      }
                      pending={pending}
                      onReply={onReply}
                      onResolve={onResolve}
                      onReopen={onReopen}
                      onRevealAnchor={onRevealAnchor}
                    />
                  ))}
                </ul>
              ) : null}

              {importedComments.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h4 className="text-item text-ink">From the Word file</h4>
                  <ul
                    className="flex flex-col gap-3"
                    aria-label="Imported comments"
                  >
                    {importedComments.map((comment) => (
                      <ImportedCommentCard
                        key={comment.id}
                        deleteItems={deleteItems(
                          comment.replies.map(deleteReplyItem),
                        )}
                        comment={comment}
                        canEdit={canEdit}
                        pending={pending}
                        onReply={onReply}
                        onRevealAnchor={onRevealAnchor}
                      />
                    ))}
                  </ul>
                </div>
              ) : null}

              {orphanedReplies.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h4 className="text-item text-ink">
                    Replies to comments no longer in this file
                  </h4>
                  <ul
                    className="flex flex-col gap-3"
                    aria-label="Replies without a comment"
                  >
                    {orphanedReplies.map((reply) => (
                      <li
                        key={reply.id}
                        className="flex flex-col gap-1 border-t border-line pt-3"
                      >
                        <ReplyBody reply={reply} />
                        {deletableCommentIds.includes(reply.id) ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="-ml-2 self-start"
                            disabled={pending}
                            onClick={() =>
                              setDeleting({
                                id: reply.id,
                                body: reply.body,
                                thread: false,
                              })
                            }
                          >
                            Delete reply
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          )}
        </>
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogTitle>
            Delete {deleting?.thread ? 'thread' : 'reply'}?
          </DialogTitle>
          <DialogDescription>
            {deleting?.thread
              ? 'This deletes the comment and all its replies.'
              : 'This deletes only this reply.'}{' '}
            You can restore it from Deleted comments.
          </DialogDescription>
          <p className="whitespace-pre-wrap text-sm text-ink">
            {deleting?.body}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if (deleting) onDelete?.(deleting.id)
                setDeleting(null)
              }}
            >
              Delete {deleting?.thread ? 'thread' : 'reply'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
