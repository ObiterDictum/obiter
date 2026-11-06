import type { DocumentCommentReply } from '@obiter/contracts'
import { Button, Input, PersonName } from '@obiter/ui'
import { useState } from 'react'
import { formatDateTime } from '../../format'
export function ReplyList({ replies }: { replies: DocumentCommentReply[] }) {
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

export function ReplyBody({ reply }: { reply: DocumentCommentReply }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-ink">
          {reply.imported ? (
            (reply.author.name ?? 'Unknown author')
          ) : (
            <PersonName person={reply.author} />
          )}
        </p>
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

export function ReplyForm({
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
