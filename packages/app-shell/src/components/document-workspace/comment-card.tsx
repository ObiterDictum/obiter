import type { DocumentComment, DocumentCommentAnchor } from '@obiter/contracts'
import {
  Badge,
  Button,
  Menu,
  MenuContent,
  MenuTrigger,
  PersonName,
} from '@obiter/ui'
import { DotsThree } from '@obiter/ui/icons'
import type { ReactNode } from 'react'
import { formatDateTime } from '../../format'
import { ReplyList, ReplyForm } from './comment-replies'
export function CommentCard({
  deleteItems,
  comment,
  canEdit,
  mayResolve,
  pending,
  onReply,
  onResolve,
  onReopen,
  onRevealAnchor,
}: {
  deleteItems: ReactNode | null
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
      <CommentFooter
        status={resolved ? 'Resolved' : 'Open'}
        tone={resolved ? 'success' : 'neutral'}
        note={comment.anchorResolved ? null : 'anchor no longer resolves'}
        actions={
          <>
            {comment.anchorResolved ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRevealAnchor(comment.anchor)}
              >
                Show in document
              </Button>
            ) : null}
            {mayResolve ? (
              resolved ? (
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
              )
            ) : null}
          </>
        }
        menu={deleteItems}
      />
      <ReplyList replies={comment.replies} />
      {canEdit ? (
        <ReplyForm parentId={comment.id} pending={pending} onReply={onReply} />
      ) : null}
    </li>
  )
}

export function CommentFooter({
  status,
  tone,
  note,
  actions,
  menu,
}: {
  status: string
  tone: 'neutral' | 'success'
  note?: string | null
  actions: ReactNode
  menu: ReactNode | null
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="flex flex-wrap items-center gap-1">
        <Badge tone={tone}>{status}</Badge>
        {note ? <span className="text-caption text-subtle">{note}</span> : null}
      </span>
      <span className="-mr-2 flex flex-wrap items-center justify-end gap-1">
        {actions}
        {menu === null ? null : (
          <Menu>
            <MenuTrigger
              render={
                <Button variant="ghost" size="sm" aria-label="More actions">
                  <DotsThree size={18} aria-hidden />
                </Button>
              }
            />
            <MenuContent aria-label="Comment actions">{menu}</MenuContent>
          </Menu>
        )}
      </span>
    </div>
  )
}
