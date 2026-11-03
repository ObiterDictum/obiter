import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { AGENT_GOAL_MAX_LENGTH, type AgentRun } from '@obiter/contracts'
import { Badge, Button, KeyboardHint, Skeleton } from '@obiter/ui'
import { ArrowLeft, FileText, Folders, X } from '@obiter/ui/icons'
import {
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { AgentRunView } from './agent-run-view'
import {
  useCreateAgentRun,
  useMatterAgentRuns,
  useOrganisationAgentSettings,
} from './agent-runs'
import { agentRunStatusLabel } from './agent-timeline'
import { currentUserQueryOptions } from './current-user'
import { useDocument } from './documents'
import {
  formatShortcut,
  isPrimaryModifier,
  useIsMacPlatform,
} from './keyboard-platform'
import { useMatter } from './matters'
import { documentIdFromPath, matterIdFromPath } from './navigation'

export function AgentTab() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const matterId = matterIdFromPath(pathname)
  if (!matterId) {
    return (
      <p className="text-body text-muted">
        Open a matter to ask the agent about it. It works on one matter at a
        time and answers with the sources it relied on.
      </p>
    )
  }
  return (
    <MatterAgent
      key={matterId}
      matterId={matterId}
      documentId={documentIdFromPath(pathname)}
    />
  )
}

function MatterAgent({
  matterId,
  documentId,
}: {
  matterId: string
  documentId: string | null
}) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-5">
      <AskForm
        matterId={matterId}
        documentId={documentId}
        onStarted={setSelectedRunId}
      />
      {selectedRunId ? (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setSelectedRunId(null)}
            className="flex items-center gap-1 self-start text-meta text-muted hover:text-ink"
          >
            <ArrowLeft size={12} aria-hidden />
            All runs
          </button>
          <AgentRunView runId={selectedRunId} />
        </div>
      ) : (
        <RunsList matterId={matterId} onSelect={setSelectedRunId} />
      )}
    </div>
  )
}

function AskForm({
  matterId,
  documentId,
  onStarted,
}: {
  matterId: string
  documentId: string | null
  onStarted: (runId: string) => void
}) {
  const isMac = useIsMacPlatform()
  const [goal, setGoal] = useState('')
  const [includeDocument, setIncludeDocument] = useState(true)
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  )
  const create = useCreateAgentRun(matterId)
  const attachedDocumentId = includeDocument ? documentId : null
  const trimmed = goal.trim()

  function submit(event?: FormEvent) {
    event?.preventDefault()
    if (!trimmed || create.isPending) return
    create.mutate(
      {
        goal: trimmed,
        idempotencyKey,
        ...(attachedDocumentId ? { documentId: attachedDocumentId } : {}),
      },
      {
        onSuccess: (run) => {
          setGoal('')
          setIdempotencyKey(crypto.randomUUID())
          onStarted(run.id)
        },
      },
    )
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && isPrimaryModifier(event)) submit()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
      <label htmlFor="agent-goal" className="text-meta font-medium text-ink">
        Ask about this matter
      </label>
      <div className="flex flex-wrap gap-1.5" aria-label="Context">
        <MatterChip matterId={matterId} />
        {documentId && includeDocument ? (
          <DocumentChip
            documentId={documentId}
            onRemove={() => setIncludeDocument(false)}
          />
        ) : null}
        {documentId && !includeDocument ? (
          <button
            type="button"
            onClick={() => setIncludeDocument(true)}
            className="rounded-sm px-2 py-1 text-caption text-muted hover:bg-hover hover:text-ink"
          >
            Add this document
          </button>
        ) : null}
      </div>
      <textarea
        id="agent-goal"
        value={goal}
        maxLength={AGENT_GOAL_MAX_LENGTH}
        rows={3}
        placeholder="What does the law say about…"
        onChange={(event) => {
          setGoal(event.target.value)
          if (create.isError) create.reset()
        }}
        onKeyDown={onKeyDown}
        className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-body text-ink placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <MatterTextNote documentAttached={attachedDocumentId !== null} />
        <Button
          type="submit"
          size="sm"
          loading={create.isPending}
          disabled={!trimmed}
        >
          Ask
          <KeyboardHint aria-hidden>
            {formatShortcut(['primary', 'Enter'], isMac)}
          </KeyboardHint>
        </Button>
      </div>
      {create.error ? (
        <p role="alert" className="text-meta text-danger">
          {create.error.message}
        </p>
      ) : null}
    </form>
  )
}

function Chip({
  icon,
  label,
  onRemove,
}: {
  icon: ReactNode
  label: string
  onRemove?: () => void
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-sm bg-fill px-2 py-1 text-caption text-ink">
      {icon}
      <span className="truncate">{label}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className="-mr-1 rounded-sm p-0.5 text-muted hover:bg-hover hover:text-ink"
        >
          <X size={10} aria-hidden />
        </button>
      ) : null}
    </span>
  )
}

function MatterChip({ matterId }: { matterId: string }) {
  const matter = useMatter(matterId)
  return (
    <Chip
      icon={<Folders size={12} aria-hidden className="text-subtle" />}
      label={matter.data?.name ?? 'This matter'}
    />
  )
}

function DocumentChip({
  documentId,
  onRemove,
}: {
  documentId: string
  onRemove: () => void
}) {
  const document = useDocument(documentId)
  const name =
    document.data?.document.currentVersion?.filename ??
    document.data?.versions[0]?.filename ??
    'This document'
  return (
    <Chip
      icon={<FileText size={12} aria-hidden className="text-subtle" />}
      label={name}
      onRemove={onRemove}
    />
  )
}

function MatterTextNote({ documentAttached }: { documentAttached: boolean }) {
  const me = useQuery(currentUserQueryOptions())
  const settings = useOrganisationAgentSettings(
    me.data?.organisation?.id ?? null,
  )
  if (!settings.data) return <span />
  const provider = settings.data.model?.provider ?? 'the model provider'
  const text = settings.data.matterTextToModel
    ? `Your question and the documents it reads go to ${provider}.`
    : documentAttached
      ? 'Matter documents are not sent to the model provider. Ask about the law, or an owner can allow it in Settings.'
      : `Your question goes to ${provider}. Matter documents are not sent.`
  return <p className="text-caption text-muted">{text}</p>
}

function RunsList({
  matterId,
  onSelect,
}: {
  matterId: string
  onSelect: (runId: string) => void
}) {
  const runs = useMatterAgentRuns(matterId)
  if (runs.isPending) return <Skeleton className="h-16" />
  if (runs.error) {
    return (
      <p role="alert" className="text-meta text-danger">
        {runs.error.message}
      </p>
    )
  }
  if (runs.data.length === 0) {
    return (
      <p className="text-meta text-muted">
        No runs on this matter yet. Each answer lists the sources it relied on.
      </p>
    )
  }
  return (
    <section aria-labelledby="agent-runs-heading">
      <h3 id="agent-runs-heading" className="text-meta font-medium text-ink">
        Runs on this matter
      </h3>
      <ul className="mt-1 flex flex-col">
        {runs.data.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              onClick={() => onSelect(run.id)}
              className="flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-hover"
            >
              <span className="line-clamp-2 text-meta text-ink">
                {run.goal}
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={statusTone(run)}>{agentRunStatusLabel(run)}</Badge>
                <time
                  dateTime={run.createdAt}
                  className="text-caption text-subtle"
                >
                  {new Date(run.createdAt).toLocaleString()}
                </time>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function statusTone(run: AgentRun) {
  switch (run.status) {
    case 'completed':
      return 'success' as const
    case 'failed':
      return 'danger' as const
    case 'refused':
      return 'warning' as const
    case 'queued':
    case 'running':
    case 'waiting_for_approval':
      return 'info' as const
    case 'cancelled':
      return 'neutral' as const
  }
}
