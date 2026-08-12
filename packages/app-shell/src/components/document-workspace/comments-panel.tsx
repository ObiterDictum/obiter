import type { DocumentComment } from '@obiter/contracts'
import { Button, EmptyState, Input } from '@obiter/ui'
import { useState } from 'react'

export function DocumentCommentsPanel({
  comments,
  selectedParagraphId,
  selectedParagraphLength,
  canEdit,
  pending,
  error,
  onCreate,
  onResolve,
}: {
  comments: DocumentComment[]
  selectedParagraphId: string | null
  selectedParagraphLength: number
  canEdit: boolean
  pending: boolean
  error: string | null
  onCreate: (input: {
    body: string
    paragraphId: string
    endOffset: number
  }) => void
  onResolve: (commentId: string) => void
}) {
  const [body, setBody] = useState('')
  const open = comments.filter((comment) => comment.resolvedAt === null)
  const resolved = comments.filter((comment) => comment.resolvedAt !== null)

  return (
    <aside
      className="flex w-full flex-col gap-5 lg:max-w-sm"
      aria-label="Comments"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink">Comments</h3>
        <p className="text-xs leading-relaxed text-muted">
          Select a paragraph, then write a plain-text comment anchored to it.
        </p>
      </div>

      {canEdit ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!selectedParagraphId || body.trim() === '') return
            onCreate({
              body: body.trim(),
              paragraphId: selectedParagraphId,
              endOffset: selectedParagraphLength,
            })
            setBody('')
          }}
        >
          <Input
            label="New comment"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              selectedParagraphId
                ? 'Comment on the selected paragraph'
                : 'Select a paragraph first'
            }
            disabled={!selectedParagraphId || pending}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!selectedParagraphId || body.trim() === '' || pending}
            loading={pending}
          >
            Add comment
          </Button>
        </form>
      ) : (
        <p className="text-xs text-muted">
          You can read comments on this matter. Editing requires edit access.
        </p>
      )}

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {comments.length === 0 ? (
        <EmptyState
          title="No comments yet"
          body="Comments stay with this document and are written into exported Word files."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {open.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              canEdit={canEdit}
              pending={pending}
              onResolve={onResolve}
            />
          ))}
          {resolved.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              canEdit={false}
              pending={pending}
              onResolve={onResolve}
            />
          ))}
        </ul>
      )}
    </aside>
  )
}

function CommentCard({
  comment,
  canEdit,
  pending,
  onResolve,
}: {
  comment: DocumentComment
  canEdit: boolean
  pending: boolean
  onResolve: (commentId: string) => void
}) {
  const resolved = comment.resolvedAt !== null
  return (
    <li className="flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">{comment.author.name}</p>
        <p className="font-mono text-[11px] text-subtle">
          {new Date(comment.createdAt).toLocaleString()}
        </p>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
        {comment.body}
      </p>
      <p className="text-[11px] uppercase tracking-[0.14em] text-subtle">
        {resolved ? 'Resolved' : 'Open'} · paragraph{' '}
        {comment.anchor.paragraphId}
      </p>
      {canEdit && !resolved ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onResolve(comment.id)}
        >
          Resolve
        </Button>
      ) : null}
    </li>
  )
}
