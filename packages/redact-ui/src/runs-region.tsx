import { useQuery } from '@tanstack/react-query'
import { apiFetch, useDocument } from '@obiter/app-shell'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import type { RedactionRun } from './types'
import { useCreateDocumentRedactionRun } from './hooks'

export function RedactionRunsRegion({
  documentId,
  onOpenRun,
}: {
  documentId: string
  onOpenRun: (runId: string) => void
}) {
  const document = useDocument(documentId)
  const create = useCreateDocumentRedactionRun(documentId)
  const query = useQuery({
    queryKey: ['document-redaction-runs', documentId],
    queryFn: () =>
      apiFetch<{ runs: RedactionRun[] }>(
        `/api/documents/${documentId}/redaction-runs`,
      ),
    staleTime: 30_000,
  })
  const ready =
    document.data?.document.currentVersion?.documentStatus === 'ready'
  const createRun = () =>
    create.mutate(undefined, { onSuccess: ({ run }) => onOpenRun(run.id) })

  if (query.isPending || document.isPending)
    return <Skeleton className="h-24" />
  if (query.error)
    return (
      <EmptyState
        title="Redaction runs are unavailable"
        body={query.error.message}
      />
    )
  if (!query.data?.runs.length)
    return (
      <div className="flex flex-col gap-3">
        <EmptyState
          title="No redaction runs yet"
          body={
            ready
              ? 'Create a run to detect sensitive information before reviewing this document.'
              : 'This document must finish text extraction before it can be redacted.'
          }
        />
        <CreateDocumentRunButton
          disabled={!ready}
          pending={create.isPending}
          onClick={createRun}
        />
        {create.error ? (
          <p className="text-sm text-danger">{create.error.message}</p>
        ) : null}
      </div>
    )
  return (
    <div className="flex flex-col gap-3">
      <CreateDocumentRunButton
        disabled={!ready}
        pending={create.isPending}
        onClick={createRun}
      />
      {create.error ? (
        <p className="text-sm text-danger">{create.error.message}</p>
      ) : null}
      <div className="flex flex-col divide-y divide-line rounded-md border border-line">
        {query.data.runs.map((run) => (
          <div
            key={run.id}
            className="flex items-center justify-between gap-3 p-3"
          >
            <div>
              <p className="font-mono text-sm text-ink">{run.id}</p>
              <p className="text-xs text-muted">
                {run.summary.totalSpans} spans · {run.summary.reviewedCount}{' '}
                reviewed
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={run.status === 'finalized' ? 'success' : 'info'}>
                {run.status.replaceAll('_', ' ')}
              </Badge>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onOpenRun(run.id)}
              >
                Review
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CreateDocumentRunButton({
  disabled,
  pending,
  onClick,
}: {
  disabled: boolean
  pending: boolean
  onClick: () => void
}) {
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={disabled}
      loading={pending}
      onClick={onClick}
    >
      Redact this document
    </Button>
  )
}
