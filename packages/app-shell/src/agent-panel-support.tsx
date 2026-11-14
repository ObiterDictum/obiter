import { useQuery } from '@tanstack/react-query'
import { AGENT_PROVIDERS, type AgentRun } from '@obiter/contracts'
import { Badge, Skeleton } from '@obiter/ui'
import { FileText, Folders, X } from '@obiter/ui/icons'
import type { ReactNode } from 'react'
import { useMatterAgentRuns, useOrganisationAgentSettings } from './agent-runs'
import { agentRunStatusLabel } from './agent-timeline'
import { currentUserQueryOptions } from './current-user'
import { useDocument } from './documents'
import { useMatter } from './matters'
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

export function MatterChip({ matterId }: { matterId: string }) {
  const matter = useMatter(matterId)
  return (
    <Chip
      icon={<Folders size={12} aria-hidden className="text-subtle" />}
      label={matter.data?.name ?? 'This matter'}
    />
  )
}

export function DocumentChip({
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

export function MatterTextNote({
  documentAttached,
  lawOnly = false,
}: {
  lawOnly?: boolean
  documentAttached: boolean
}) {
  const me = useQuery(currentUserQueryOptions())
  const settings = useOrganisationAgentSettings(
    me.data?.organisation?.id ?? null,
  )
  if (!settings.data) return <span />
  if (!settings.data.model)
    return (
      <p className="text-caption text-muted">
        No agent model is set for this organisation. An owner or admin can set
        one in Settings.
      </p>
    )
  if (lawOnly) return null
  const provider = AGENT_PROVIDERS[settings.data.model.provider].label
  const text = settings.data.matterTextToModel
    ? `Your question and the documents it reads go to ${provider}.`
    : documentAttached
      ? 'Matter documents are not sent to the model provider. Ask about the law, or an owner can allow it in Settings.'
      : `Your question goes to ${provider}. Matter documents are not sent.`
  return <p className="text-caption text-muted">{text}</p>
}

export function RunsList({
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
  if (runs.data.length === 0) return null
  return (
    <section aria-labelledby="agent-runs-heading">
      <h3 id="agent-runs-heading" className="text-meta font-medium text-ink">
        Earlier runs
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
