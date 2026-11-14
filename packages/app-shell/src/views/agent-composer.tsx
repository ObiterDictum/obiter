import {
  AGENT_GOAL_MAX_LENGTH,
  type AgentSessionDetailResponse,
} from '@obiter/contracts'
import { useId, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, CircleNotch } from '@obiter/ui/icons'
import { ApiError } from '../api'
import { createSession, postTurn, sessionKeys } from '../agent-sessions'

const starters = [
  'What are the elements of negligence?',
  'Explain the test for judicial review.',
  'When can a contract be frustrated?',
]

export function AgentComposer({
  sessionId,
  matterId,
  live = false,
  onSent,
  showStarters = false,
}: {
  sessionId?: string
  matterId: string | null
  live?: boolean
  onSent: (id: string) => void
  showStarters?: boolean
}) {
  const id = useId()
  const [text, setText] = useState('')
  const submission = useRef<{
    text: string
    createKey: string
    turnKey: string
    sessionId?: string
  } | null>(null)
  const client = useQueryClient()
  const send = useMutation({
    mutationFn: async () => {
      const message = text.trim()
      if (!submission.current || submission.current.text !== message) {
        submission.current = {
          text: message,
          createKey: crypto.randomUUID(),
          turnKey: crypto.randomUUID(),
          sessionId,
        }
      }
      const pending = submission.current
      if (!pending.sessionId)
        pending.sessionId = (
          await createSession(matterId, pending.text, pending.createKey)
        ).id
      const { run } = await postTurn(
        pending.sessionId,
        pending.text,
        pending.turnKey,
      )
      return { id: pending.sessionId, run }
    },
    onSuccess: ({ id: nextId, run }) => {
      client.setQueryData<AgentSessionDetailResponse>(
        sessionKeys.detail(nextId),
        (previous) =>
          previous
            ? {
                session: { ...previous.session, activeRunId: run.id },
                runs: [
                  ...previous.runs.filter((item) => item.id !== run.id),
                  run,
                ],
              }
            : previous,
      )
      setText('')
      submission.current = null
      void client.invalidateQueries({ queryKey: sessionKeys.lists })
      void client.invalidateQueries({ queryKey: sessionKeys.detail(nextId) })
      onSent(nextId)
    },
    onError: () => {
      if (sessionId)
        void client.invalidateQueries({
          queryKey: sessionKeys.detail(sessionId),
        })
    },
  })
  const disabled = live || send.isPending
  function submit() {
    if (!disabled && text.trim()) send.mutate()
  }
  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
        className="flex flex-col gap-2 rounded-xl border border-line bg-raised p-3 focus-within:ring-1 focus-within:ring-[var(--obiter-ring)]"
      >
        <label htmlFor={id} className="sr-only">
          Message
        </label>
        <textarea
          id={id}
          rows={1}
          placeholder={
            matterId
              ? 'Ask about this matter…'
              : 'Ask about case law or legislation…'
          }
          ref={(node) => {
            if (node) {
              node.style.height = 'auto'
              node.style.height = `${Math.min(node.scrollHeight, 192)}px`
            }
          }}
          maxLength={AGENT_GOAL_MAX_LENGTH}
          value={text}
          disabled={disabled}
          aria-describedby={live ? `${id}-reason` : undefined}
          onChange={(event) => {
            setText(event.target.value)
            send.reset()
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              submit()
            }
          }}
          className="max-h-48 min-h-8 w-full resize-none border-0 bg-transparent py-1 text-body text-ink outline-none"
        />
        <div className="flex items-center justify-between gap-3">
          <p id={`${id}-reason`} className="text-caption text-muted">
            {live ? (
              'Wait for the current answer before sending another message.'
            ) : (
              <span className="hidden sm:inline">
                Enter to send · Shift+Enter for a new line
              </span>
            )}
          </p>
          <button
            type="submit"
            aria-label="Send"
            disabled={disabled || !text.trim()}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-surface disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
          >
            {disabled ? (
              <CircleNotch
                size={16}
                aria-hidden
                className="motion-safe:animate-spin"
              />
            ) : (
              <ArrowRight size={16} aria-hidden className="-rotate-90" />
            )}
          </button>
        </div>
        {send.error ? (
          <p role="alert" className="text-meta text-danger">
            {send.error instanceof ApiError && send.error.status === 409
              ? 'An answer is already in progress. Wait for it to finish, then try again.'
              : send.error.message}
          </p>
        ) : null}
      </form>
      {showStarters ? (
        <div className="flex flex-wrap gap-2">
          {starters.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setText(prompt)}
              className="rounded-full border border-line px-3 py-1.5 text-meta text-muted hover:bg-hover hover:text-ink"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
