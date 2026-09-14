import { Link } from '@tanstack/react-router'
import { ListChecks } from '@phosphor-icons/react'
import { Badge, EmptyState, Skeleton } from '@obiter/ui'
import { useCurrentUser } from '../current-user'
import { verificationRunStatusLabel } from '../verification-copy'
import { useOrganisationVerificationRuns } from '../verification-runs'

export function VerifyRouteView() {
  const { data: me } = useCurrentUser()
  const runs = useOrganisationVerificationRuns(me?.organisation != null)

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
        ) : !runs.data?.runs.length ? (
          <EmptyState
            icon={<ListChecks size={28} className="text-muted" />}
            title="No verification runs yet"
            body="Open a matter document and start a verification run to check citations and quotations against stored sources."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {runs.data.runs.map((run) => (
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
                  <Badge
                    tone={
                      run.status === 'failed'
                        ? 'danger'
                        : run.status === 'completed' &&
                            run.summary.reviewRequiredCount > 0
                          ? 'warning'
                          : run.status === 'completed'
                            ? 'success'
                            : 'info'
                    }
                  >
                    {run.status === 'completed' &&
                    run.summary.reviewRequiredCount > 0
                      ? 'Needs review'
                      : verificationRunStatusLabel(run.status)}
                  </Badge>
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
        )}
      </div>
    </div>
  )
}
