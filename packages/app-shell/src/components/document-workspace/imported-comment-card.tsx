import type {
  DocumentCommentAnchor,
  DocumentImportedCommentThread,
} from '@obiter/contracts'
import { Button } from '@obiter/ui'
import type { ReactNode } from 'react'
import { formatDateTime } from '../../format'
import { CommentFooter } from './comment-card'
import { ReplyList, ReplyForm } from './comment-replies'
export function ImportedCommentCard({
  deleteItems,
  comment,
  canEdit,
  pending,
  onReply,
  onRevealAnchor,
}: {
  deleteItems: ReactNode | null
  comment: DocumentImportedCommentThread
  canEdit: boolean
  pending: boolean
  onReply: (input: { parentId: string; body: string }) => Promise<boolean>
  onRevealAnchor: (anchor: DocumentCommentAnchor) => void
}) {
  const anchor = comment.anchor
  const note = [
    comment.resolved ? 'resolved in file' : null,
    anchor === null ? 'anchor no longer resolves' : null,
  ].filter((part) => part !== null)
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
      <CommentFooter
        status="Imported"
        tone="neutral"
        note={note.length > 0 ? note.join(' · ') : null}
        actions={
          anchor !== null ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRevealAnchor(anchor)}
            >
              Show in document
            </Button>
          ) : null
        }
        menu={deleteItems}
      />
      <ReplyList replies={comment.replies} />
      {canEdit && comment.ooxmlId !== null ? (
        <ReplyForm parentId={comment.id} pending={pending} onReply={onReply} />
      ) : null}
    </li>
  )
}
