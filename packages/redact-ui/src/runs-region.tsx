import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@obiter/app-shell'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import type { RedactionRun } from './types'

export function RedactionRunsRegion({ documentId, onOpenRun }: { documentId: string; onOpenRun: (runId: string) => void }) {
  const query = useQuery({
    queryKey: ['document-redaction-runs', documentId],
    queryFn: () => apiFetch<{ runs: RedactionRun[] }>(`/api/documents/${documentId}/redaction-runs`),
    staleTime: 30_000,
  })
  if (query.isPending) return <Skeleton className="h-24" />
  if (query.error) return <EmptyState title="Redaction runs are unavailable" body={query.error.message} />
  if (!query.data?.runs.length) return <EmptyState title="No redaction runs yet" body="Create a run to detect sensitive information before reviewing this document." />
  return <div className="flex flex-col divide-y divide-line rounded-md border border-line">{query.data.runs.map((run) => <div key={run.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-mono text-sm text-ink">{run.id}</p><p className="text-xs text-muted">{run.summary.totalSpans} spans · {run.summary.reviewedCount} reviewed</p></div><div className="flex items-center gap-2"><Badge tone={run.status === 'finalized' ? 'success' : 'info'}>{run.status.replaceAll('_', ' ')}</Badge><Button size="sm" variant="secondary" onClick={() => onOpenRun(run.id)}>Review</Button></div></div>)}</div>
}
