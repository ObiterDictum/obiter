import { Link } from '@tanstack/react-router'
import { ListChecks } from '@phosphor-icons/react'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import type { VerificationRun } from '@obiter/contracts'
import { useCurrentUser } from '../current-user'
import { useMattersList } from '../matters'
import {
  verificationFailureLabel,
  verificationOutcomeAnnouncement,
  verificationOutcomeLabel,
  verificationOutcomeTone,
  verificationRunStatusLabel,
} from '../verification-copy'
import {
  useOrganisationVerificationRuns,
  useVerificationRunDocuments,
} from '../verification-runs'

function statusTone(status: 'queued' | 'running' | 'completed' | 'failed') {
  if (status === 'failed') return 'danger' as const
  if (status === 'queued' || status === 'running') return 'info' as const
  return 'neutral' as const
}

/** The completion time is the useful one once a run has finished; a queued or
 * failed run is placed by when it was created. */
function verificationRunTime(run: VerificationRun) {
  const at =
    run.status === 'completed'
      ? (run.completedAt ?? run.createdAt)
      : run.createdAt
  const label =
    run.status === 'completed'
      ? 'Completed'
      : run.status === 'failed'
        ? 'Failed'
        : 'Started'
  return `${label} ${new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(at))}`
}

export function VerifyRouteView() {
  const { data: me } = useCurrentUser()
  const enabled = me?.organisation != null
  const runs = useOrganisationVerificationRuns(enabled)
  const list = runs.runs
  const matters = useMattersList({ enabled })
  const documents = useVerificationRunDocuments(list)

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
            body="Verification starts from a document, not from this page. Open a matter, open a document, then use Run verification there."
            action={
              <Link
                to="/matters"
                className="font-semibold text-brand hover:text-brand-pressed"
              >
                Open matters
              </Link>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="flex flex-col divide-y divide-line">
              {list.map((run) => {
                const filename = documents.get(run.documentId)
                const matterName =
                  matters.data?.find((matter) => matter.id === run.matterId)
                    ?.name ?? null
                return (
                  <li
                    key={run.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {filename ?? 'Document unavailable'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {matterName ? `${matterName} · ` : null}
                        {verificationRunTime(run)}
                      </p>
                      <p className="mt-0.5 text-[11px] break-all text-subtle">
                        Stored version{' '}
                        <span className="font-mono">
                          {run.documentVersionId}
                        </span>
                        {run.stale ? ' (earlier than current)' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
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
                )
              })}
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
