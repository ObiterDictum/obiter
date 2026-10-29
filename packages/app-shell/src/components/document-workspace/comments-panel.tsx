import type {
  DocumentComment,
  DocumentCommentAnchor,
  DocumentCommentReply,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import { Button, EmptyState, Input } from '@obiter/ui'
import { useState } from 'react'
import { formatDateTime } from '../../format'

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
}: {
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
  const [body, setBody] = useState('')
  const open = comments.filter((comment) => comment.resolvedAt === null)
  const resolved = comments.filter((comment) => comment.resolvedAt !== null)

  return (
    <div className="flex flex-col gap-5">
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
          />
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!commentTarget || body.trim() === '' || pending}
              loading={pending}
              aria-describedby="comment-add-reason"
            >
              Add comment
            </Button>
            {!commentTarget ? (
              <span
                id="comment-add-reason"
                className="text-caption text-subtle"
              >
                Select text or place the caret in a paragraph first.
              </span>
            ) : body.trim() === '' ? (
              <span
                id="comment-add-reason"
                className="text-caption text-subtle"
              >
                Write the comment, then add it.
              </span>
            ) : null}
          </div>
        </form>
      ) : (
        <p className="text-caption text-muted">
          You can read comments on this matter. Editing requires edit access.
        </p>
      )}

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

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
              {open.map((comment) => (
                <CommentCard
                  key={comment.id}
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
              {resolved.map((comment) => (
                <CommentCard
                  key={comment.id}
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
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function CommentCard({
  comment,
  canEdit,
  mayResolve,
  pending,
  onReply,
  onResolve,
  onReopen,
  onRevealAnchor,
}: {
  comment: DocumentComment
  canEdit: boolean
  mayResolve: boolean
  pending: boolean
  onReply: (input: { parentId: string; body: string }) => Promise<boolean>
  onResolve: (commentId: string) => void
  onReopen: (commentId: string) => void
  onRevealAnchor: (anchor: DocumentCommentAnchor) => void
}) {
  const resolved = comment.resolvedAt !== null
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">{comment.author.name}</p>
        <p className="text-caption text-subtle">
          {formatDateTime(comment.createdAt)}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {comment.body}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-subtle">
          {resolved ? 'Resolved' : 'Open'}
          {comment.anchorResolved ? '' : ' · anchor no longer resolves'}
        </p>
        {comment.anchorResolved ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRevealAnchor(comment.anchor)}
          >
            Show in document
          </Button>
        ) : null}
      </div>
      <ReplyList replies={comment.replies} />
      {mayResolve ? (
        <div className="flex gap-2">
          {resolved ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onReopen(comment.id)}
            >
              Reopen
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => onResolve(comment.id)}
            >
              Resolve
            </Button>
          )}
        </div>
      ) : null}
      {canEdit ? (
        <ReplyForm parentId={comment.id} pending={pending} onReply={onReply} />
      ) : null}
    </li>
  )
}

function ImportedCommentCard({
  comment,
  canEdit,
  pending,
  onReply,
  onRevealAnchor,
}: {
  comment: DocumentImportedCommentThread
  canEdit: boolean
  pending: boolean
  onReply: (input: { parentId: string; body: string }) => Promise<boolean>
  onRevealAnchor: (anchor: DocumentCommentAnchor) => void
}) {
  const anchor = comment.anchor
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {comment.author ?? 'Unknown author'}
        </p>
        {comment.createdAt ? (
          <p className="text-caption text-subtle">
            {formatDateTime(comment.createdAt)}
          </p>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {comment.body}
        {comment.bodyTruncated ? '…' : ''}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-caption text-subtle">
          Imported
          {comment.resolved ? ' · resolved in file' : ''}
          {comment.anchor === null ? ' · anchor no longer resolves' : ''}
        </p>
        {anchor !== null ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRevealAnchor(anchor)}
          >
            Show in document
          </Button>
        ) : null}
      </div>
      <ReplyList replies={comment.replies} />
      {canEdit && comment.ooxmlId !== null ? (
        <ReplyForm parentId={comment.id} pending={pending} onReply={onReply} />
      ) : null}
    </li>
  )
}

function ReplyList({ replies }: { replies: DocumentCommentReply[] }) {
  if (replies.length === 0) return null
  return (
    <ul className="flex flex-col gap-2 border-l-2 border-line pl-3">
      {replies.map((reply) => (
        <li key={reply.id} className="flex flex-col gap-1">
          <ReplyBody reply={reply} />
        </li>
      ))}
    </ul>
  )
}

function ReplyBody({ reply }: { reply: DocumentCommentReply }) {
  const name = reply.imported
    ? (reply.author.name ?? 'Unknown author')
    : reply.author.name
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-ink">{name}</p>
        {reply.createdAt ? (
          <p className="text-caption text-subtle">
            {formatDateTime(reply.createdAt)}
          </p>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {reply.body}
      </p>
    </>
  )
}

function ReplyForm({
  parentId,
  pending,
  onReply,
}: {
  parentId: string
  pending: boolean
  onReply: (input: { parentId: string; body: string }) => Promise<boolean>
}) {
  const [body, setBody] = useState('')
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        if (body.trim() === '') return
        if (await onReply({ parentId, body: body.trim() })) setBody('')
      }}
    >
      <Input
        label="Reply"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Reply to this comment"
        disabled={pending}
      />
      <Button
        type="submit"
        variant="ghost"
        size="sm"
        disabled={body.trim() === '' || pending}
      >
        Reply
      </Button>
    </form>
  )
}
