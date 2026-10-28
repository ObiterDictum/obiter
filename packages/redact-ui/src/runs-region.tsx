import { useQuery } from '@tanstack/react-query'
import { useRef } from 'react'
import { apiFetch, useDocument } from '@obiter/app-shell'
import { Button, Card, EmptyState, Skeleton, StatusDot } from '@obiter/ui'
import type { RedactionRun } from './types'
import { useCreateDocumentRedactionRun } from './hooks'
import { formatDate } from './span-copy'

const runStatus = {
  pending: { label: 'Waiting to start', tone: 'neutral' },
  detecting: { label: 'Detecting', tone: 'info' },
  ready_for_review: { label: 'Ready for review', tone: 'warning' },
  reviewing: { label: 'In review', tone: 'info' },
  finalized: { label: 'Finalised', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
} satisfies Record<
  RedactionRun['status'],
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
>

/**
 * The redaction runs for one document, on the document page (contract §4). A
 * run is described by its state and its decided count, never by its id.
 */
export function RedactionRunsRegion({
  documentId,
  onOpenRun,
}: {
  documentId: string
  onOpenRun: (runId: string) => void
}) {
  const document = useDocument(documentId)
  const create = useCreateDocumentRedactionRun()
  const creating = useRef(false)
  const query = useQuery({
    queryKey: ['document-redaction-runs', documentId],
    queryFn: () =>
      apiFetch<{ runs: RedactionRun[] }>(
        `/api/documents/${documentId}/redaction-runs`,
      ),
    staleTime: 30_000,
  })
  const version = document.data?.document.currentVersion
  const ready = version?.documentStatus === 'ready'
  const failed = version?.documentStatus === 'failed'
  const createRun = () => {
    if (create.isPending || creating.current || !ready) return
    creating.current = true
    create.mutate(documentId, {
      onSuccess: ({ run }) => {
        creating.current = false
        onOpenRun(run.id)
      },
      onError: () => {
        creating.current = false
      },
    })
  }

  if (query.isPending || document.isPending)
    return <Skeleton className="h-24" />
  if (document.isError)
    return (
      <EmptyState
        title="Document is unavailable"
        body={document.error.message}
      />
    )
  if (query.error)
    return (
      <EmptyState
        title="Redaction runs are unavailable"
        body={query.error.message}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Try again
          </Button>
        }
      />
    )

  const runs = query.data?.runs ?? []
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div>
          <h2 className="text-section text-ink">Redaction runs</h2>
          <p className="mt-0.5 text-meta text-muted">
            {runs.length === 0
              ? 'No runs yet for this document.'
              : `${String(runs.length)} ${runs.length === 1 ? 'run' : 'runs'} for this document.`}
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={!ready}
          loading={create.isPending}
          onClick={createRun}
        >
          Redact this document
        </Button>
      </div>
      {!ready ? (
        <p className="px-6 pt-4 text-meta text-muted">
          {failed
            ? (version?.failureReason ??
              'Text extraction failed for this document, so it cannot be redacted yet.')
            : 'This document must finish text extraction before it can be redacted.'}
        </p>
      ) : null}
      {create.error ? (
        <p className="px-6 pt-4 text-meta text-danger" role="alert">
          The run was not started. {create.error.message}
        </p>
      ) : null}
      {runs.length === 0 ? (
        <p className="px-6 py-4 text-meta text-muted">
          Create a run to find the sensitive spans in this document before you
          finalise a redacted copy.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col">
          {runs.map((run) => {
            const status = runStatus[run.status]
            return (
              <li
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <StatusDot tone={status.tone}>{status.label}</StatusDot>
                    <span className="text-caption tabular-nums text-muted">
                      {run.summary.reviewedCount} of {run.summary.totalSpans}{' '}
                      decided
                    </span>
                  </div>
                  <p className="mt-1 text-caption text-subtle">
                    Started {formatDate(run.createdAt)}
                  </p>
                  {run.status === 'failed' ? (
                    <p className="mt-1 text-caption text-danger" role="alert">
                      {run.summary.failureReason ??
                        'The detector stopped before it finished, so this run found nothing.'}
                    </p>
                  ) : null}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenRun(run.id)}
                >
                  {run.status === 'finalized' ? 'View' : 'Review'}
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
