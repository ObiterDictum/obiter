import { Link } from '@tanstack/react-router'
import { ListChecks } from '@phosphor-icons/react'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import { useCurrentUser } from '../current-user'
import {
  verificationFailureLabel,
  verificationOutcomeAnnouncement,
  verificationOutcomeLabel,
  verificationOutcomeTone,
  verificationRunStatusLabel,
} from '../verification-copy'
import { useOrganisationVerificationRuns } from '../verification-runs'

function statusTone(status: 'queued' | 'running' | 'completed' | 'failed') {
  if (status === 'failed') return 'danger' as const
  if (status === 'queued' || status === 'running') return 'info' as const
  return 'neutral' as const
}

export function VerifyRouteView() {
  const { data: me } = useCurrentUser()
  const runs = useOrganisationVerificationRuns(me?.organisation != null)
  const list = runs.runs

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-sm font-semibold text-ink">Verify</h1>
          <p className="text-xs text-muted">
            Citation, authority, and quote checks on stored document versions
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1 p-6">
        {runs.isPending ? (
          <Skeleton className="h-24" aria-label="Loading verification runs" />
        ) : runs.isError ? (
          <EmptyState
            icon={<ListChecks size={28} className="text-muted" />}
            title="Verification runs are unavailable"
            body={runs.error.message}
          />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<ListChecks size={28} className="text-muted" />}
            title="No verification runs yet"
            body="Open a matter document and start a verification run to check citations and quotations against stored sources."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col divide-y divide-line">
              {list.map((run) => (
                <li
                  key={run.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-ink">
                      {run.id}
                    </p>
                    <p className="text-[11px] text-muted">
                      Version {run.documentVersionId}
                      {run.stale ? ' (earlier than current)' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={statusTone(run.status)}>
                      {verificationRunStatusLabel(run.status)}
                    </Badge>
                    {run.status === 'completed' ? (
                      <>
                        <Badge tone={verificationOutcomeTone(run.summary)}>
                          {verificationOutcomeLabel(run.summary)}
                        </Badge>
                        <span className="sr-only">
                          {verificationOutcomeAnnouncement(run.summary)}
                        </span>
                      </>
                    ) : null}
                    {run.failureCode ? (
                      <Badge tone="danger">
                        {verificationFailureLabel(run.failureCode)}
                      </Badge>
                    ) : null}
                    <Link
                      to="/matters/$matterId/documents/$documentId"
                      params={{
                        matterId: run.matterId,
                        documentId: run.documentId,
                      }}
                      className="text-sm font-medium text-brand hover:text-brand-pressed"
                    >
                      Open document
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {runs.hasNextPage ? (
              <Button
                variant="ghost"
                size="sm"
                loading={runs.isFetchingNextPage}
                onClick={() => void runs.fetchNextPage()}
              >
                Load more runs
              </Button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
