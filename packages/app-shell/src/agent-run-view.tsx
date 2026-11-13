import { Link } from '@tanstack/react-router'
import {
  isAgentRunLive,
  type AgentEvidence,
  type AgentRun,
} from '@obiter/contracts'
import { Button, Skeleton, cn } from '@obiter/ui'
import {
  CheckCircle,
  CircleNotch,
  MinusCircle,
  Warning,
} from '@obiter/ui/icons'
import type { ReactNode } from 'react'
import { useAgentRun, useAgentRunStream, useCancelAgentRun } from './agent-runs'
import {
  agentRunStatusLabel,
  agentRunSummary,
  agentTimelineRows,
  type AgentTimelineStatus,
} from './agent-timeline'

export function AgentRunView({ runId }: { runId: string }) {
  const detail = useAgentRun(runId)
  const cancel = useCancelAgentRun()
  useAgentRunStream(detail.data?.run)

  if (detail.isPending) {
    return <Skeleton className="h-24" />
  }
  if (!detail.data) {
    return (
      <p role="alert" className="text-meta text-danger">
        {detail.error?.message ?? 'Could not load this run.'}
      </p>
    )
  }

  const { run, events } = detail.data
  const rows = agentTimelineRows(events)
  const live = isAgentRunLive(run)

  return (
    <article aria-label="Agent run" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="text-body text-ink">{run.goal}</p>
        <p className="text-meta text-muted" aria-live="polite">
          {agentRunSummary(run)}
        </p>
      </header>

      <ol aria-label="Steps" className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li
            key={`${row.step}-${row.label}`}
            className="flex items-start gap-2 text-meta text-muted"
          >
            <StepIcon status={row.status} />
            <span>{row.label}</span>
          </li>
        ))}
        {live && rows.length === 0 ? (
          <li className="flex items-center gap-2 text-meta text-muted">
            <StepIcon status="running" />
            Starting
          </li>
        ) : null}
      </ol>

      {live ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            loading={cancel.isPending}
            onClick={() => cancel.mutate(run.id)}
          >
            Cancel run
          </Button>
          {cancel.error ? (
            <p role="alert" className="mt-2 text-meta text-danger">
              {cancel.error.message}
            </p>
          ) : null}
        </div>
      ) : (
        <RunOutcome run={run} />
      )}
    </article>
  )
}

function StepIcon({ status }: { status: AgentTimelineStatus }) {
  const className = 'mt-0.5 shrink-0'
  switch (status) {
    case 'running':
      return (
        <CircleNotch
          size={14}
          aria-label="In progress"
          className={cn(className, 'animate-spin text-subtle')}
        />
      )
    case 'done':
      return (
        <CheckCircle
          size={14}
          aria-label="Done"
          className={cn(className, 'text-success')}
        />
      )
    case 'error':
      return (
        <Warning
          size={14}
          aria-label="Failed"
          className={cn(className, 'text-danger')}
        />
      )
    case 'refused':
      return (
        <MinusCircle
          size={14}
          aria-label="Refused"
          className={cn(className, 'text-warning')}
        />
      )
  }
}

function RunOutcome({ run }: { run: AgentRun }) {
  switch (run.status) {
    case 'completed':
      return <AgentAnswerView run={run} />
    case 'cancelled':
      return <Notice tone="muted">You cancelled this run.</Notice>
    case 'failed':
      return (
        <Notice tone="danger" title={agentRunStatusLabel(run)}>
          {run.message}
        </Notice>
      )
    case 'refused':
      return (
        <Notice tone="warning" title={agentRunStatusLabel(run)}>
          <p>{run.refusal.message}</p>
          {run.refusal.missing ? (
            <p className="mt-1">
              Missing: <strong>{run.refusal.missing.label}</strong>
              {run.refusal.missing.kind === 'setting' ? (
                <>
                  {' '}
                  in{' '}
                  <Link
                    to="/settings"
                    search={{ section: 'agent' }}
                    className="text-brand underline"
                  >
                    Settings
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </Notice>
      )
    case 'queued':
    case 'running':
    case 'waiting_for_approval':
      return null
  }
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: 'muted' | 'danger' | 'warning'
  title?: string
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'muted' ? undefined : 'alert'}
      className={cn(
        'rounded-md px-3 py-2 text-meta',
        tone === 'muted' && 'bg-fill text-muted',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'warning' && 'bg-warning-soft text-ink',
      )}
    >
      {title ? <p className="font-medium">{title}</p> : null}
      <div className={title ? 'mt-1' : undefined}>{children}</div>
    </div>
  )
}

function AgentAnswerView({
  run,
}: {
  run: Extract<AgentRun, { status: 'completed' }>
}) {
  const { answer } = run
  const numbers = new Map(
    answer.evidence.map((item, index) => [item.evidenceId, index + 1]),
  )

  return (
    <section aria-label="Answer" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-body text-ink">
        {answer.sentences.map((sentence, index) => (
          <p key={index}>
            {sentence.text}
            {sentence.evidenceIds.map((evidenceId) => {
              const item = answer.evidence.find(
                (candidate) => candidate.evidenceId === evidenceId,
              )
              const number = numbers.get(evidenceId)
              return item && number ? (
                <EvidenceLink
                  key={evidenceId}
                  matterId={run.matterId}
                  evidence={item}
                  className="ml-1 align-super text-caption text-brand"
                >
                  [{number}]
                </EvidenceLink>
              ) : null
            })}
          </p>
        ))}
      </div>
      {answer.droppedSentenceCount > 0 ? (
        <p className="text-meta text-muted">
          {answer.droppedSentenceCount === 1
            ? 'One sentence was left out because it had no source.'
            : `${answer.droppedSentenceCount} sentences were left out because they had no source.`}
        </p>
      ) : null}
      <div>
        <h3 className="text-meta font-medium text-ink">Sources</h3>
        <ol className="mt-1 flex flex-col gap-2">
          {answer.evidence.map((item, index) => (
            <li key={item.evidenceId} className="text-meta text-muted">
              <span className="mr-1 tabular-nums">{index + 1}.</span>
              <EvidenceLink
                matterId={run.matterId}
                evidence={item}
                className="text-brand underline"
              >
                {evidenceLabel(item)}
              </EvidenceLink>
              {item.kind === 'document_span' ? (
                <blockquote className="mt-1 border-l-2 border-line pl-2 text-ink">
                  {item.excerpt}
                </blockquote>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

export function evidenceLabel(item: AgentEvidence): string {
  if (item.kind === 'corpus_paragraph') {
    const citation = item.neutralCitation ? ` ${item.neutralCitation}` : ''
    return `${item.title}${citation}, para ${item.paragraphNumber}`
  }
  return `${item.documentName}, characters ${item.start}–${item.end}`
}

function EvidenceLink({
  matterId,
  evidence,
  className,
  children,
}: {
  matterId: string
  evidence: AgentEvidence
  className?: string
  children: ReactNode
}) {
  if (evidence.kind === 'corpus_paragraph') {
    return (
      <Link
        to="/cases/$caseId"
        params={{ caseId: evidence.authorityId }}
        hash={`para-${evidence.paragraphNumber}`}
        className={className}
        aria-label={`Open ${evidenceLabel(evidence)}`}
      >
        {children}
      </Link>
    )
  }
  return (
    <Link
      to="/matters/$matterId/documents/$documentId"
      params={{ matterId, documentId: evidence.documentId }}
      className={className}
      aria-label={`Open ${evidenceLabel(evidence)}`}
    >
      {children}
    </Link>
  )
}
