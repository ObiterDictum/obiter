import { Robot } from '@obiter/ui/icons'
import { PagePanelToggle } from '../page-panel'
import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { ApiError } from '../api'
import { sessionQueryOptions } from '../agent-sessions'
import { ShellNotFound } from '../shell-states'
import { MatterTextNote } from '../agent-panel-support'
import { AgentComposer } from './agent-composer'
import { AgentTurn } from './agent-turn'

export function AgentWindowView() {
  const params = useParams({ strict: false })
  const navigate = useNavigate()
  const sessionId =
    'sessionId' in params && typeof params.sessionId === 'string'
      ? params.sessionId
      : undefined
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-surface px-4">
      {!sessionId ? (
        <div className="absolute pt-4">
          <PagePanelToggle />
        </div>
      ) : null}
      <div className="mx-auto flex min-h-full w-full max-w-[760px] flex-col py-6">
        {sessionId ? null : (
          <header className="mb-6 mt-auto flex flex-col items-center gap-3 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-fill text-muted">
              <Robot size={24} aria-hidden />
            </div>
            <h1 className="text-title text-ink">
              What would you like to research?
            </h1>
            <p className="text-meta text-muted">
              Only you can see this conversation. It searches case law and
              legislation; matter documents are never used.
            </p>
            <MatterTextNote documentAttached={false} lawOnly />
          </header>
        )}
        <AgentConversation
          key={sessionId ?? 'new'}
          sessionId={sessionId}
          matterId={null}
          onSent={(id) =>
            void navigate({
              to: '/agent/$sessionId',
              params: { sessionId: id },
            })
          }
        />
      </div>
    </div>
  )
}
export function AgentConversation({
  sessionId,
  matterId,
  onSent,
}: {
  sessionId?: string
  matterId: string | null
  onSent: (id: string) => void
}) {
  const detail = useQuery({
    ...sessionQueryOptions(sessionId ?? ''),
    enabled: Boolean(sessionId),
  })
  const bottom = useRef<HTMLDivElement>(null)
  if (sessionId && detail.isPending)
    return <p className="text-meta text-muted">Loading conversation…</p>
  if (
    detail.error instanceof ApiError &&
    (detail.error.status === 404 || detail.error.status === 403)
  )
    return <ShellNotFound />
  if (detail.error) return <p role="alert">{detail.error.message}</p>
  return (
    <div
      className={
        sessionId ? 'flex min-h-0 flex-1 flex-col' : 'mb-auto flex flex-col'
      }
    >
      <div className="flex-1">
        {detail.data ? (
          <header className="mb-4 flex min-w-0 items-center gap-2">
            {matterId === null ? <PagePanelToggle /> : null}
            <h1 className="truncate text-title text-ink">
              {detail.data.session.title}
            </h1>
          </header>
        ) : null}
        {detail.data?.runs.map((run) => (
          <AgentTurn key={run.id} run={run} />
        ))}
      </div>
      <div ref={bottom} />
      <div
        className={
          sessionId
            ? 'sticky bottom-0 bg-surface py-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-gradient-to-t before:from-[var(--obiter-surface)] before:to-transparent'
            : 'py-4'
        }
      >
        <AgentComposer
          sessionId={sessionId}
          matterId={detail.data?.session.matterId ?? matterId}
          live={Boolean(detail.data?.session.activeRunId)}
          showStarters={!sessionId && matterId === null}
          onSent={(id) => {
            onSent(id)
            requestAnimationFrame(() =>
              bottom.current?.scrollIntoView?.({ block: 'end' }),
            )
          }}
        />
      </div>
    </div>
  )
}
