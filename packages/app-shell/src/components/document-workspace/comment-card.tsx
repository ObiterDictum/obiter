import type { DocumentComment, DocumentCommentAnchor } from '@obiter/contracts'
import { Button, PersonName } from '@obiter/ui'
import { formatDateTime } from '../../format'
import { ReplyList, ReplyForm } from './comment-replies'
export function CommentCard({
  deletionActions,
  comment,
  canEdit,
  mayResolve,
  pending,
  onReply,
  onResolve,
  onReopen,
  onRevealAnchor,
}: {
  deletionActions: import('react').ReactNode
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
        <p className="text-sm font-medium text-ink">
          <PersonName person={comment.author} />
        </p>
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
      {deletionActions}
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
