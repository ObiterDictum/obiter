import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowSquareOut, Clock, FileText, Warning } from '@phosphor-icons/react'
import type {
  VerificationFindingView,
  VerificationRun,
} from '@obiter/contracts'
import { Button, cn } from '@obiter/ui'
import {
  formatRunTime,
  verificationCountsLabel,
  verificationFailureLabel,
  verificationFailureTitle,
  verificationRunTime,
  verificationSummaryCounts,
  verificationVersionNote,
} from '../verification-copy'
import {
  useCreateVerificationRun,
  useUndismissVerificationFinding,
  useVerificationFindings,
  type RunDocumentIdentity,
} from '../verification-runs'
import { VerifyDismissDialog } from '../components/verification/verify-dismiss-dialog'
import { VerifyFinding } from '../components/verification/verify-finding'
import {
  findingMatchesFilter,
  sortFindings,
  type VerifyDocumentGroup,
  type VerifyFilter,
} from './verify-groups'

function checkedVersionNumber(
  identity: RunDocumentIdentity,
  run: VerificationRun,
) {
  return identity.status === 'available'
    ? identity.versionNumbers.get(run.documentVersionId)
    : undefined
}

/**
 * One document's run and findings. The row states the run's state in words; the
 * body lists what the check found, each finding with its source, its pinpoint
 * and what it did not establish. A failure, a stale result and a result that
 * stopped part-way are all said plainly rather than dressed as completion.
 */
export function VerifyDocument({
  group,
  filter,
  currentUserId,
}: {
  group: VerifyDocumentGroup
  filter: VerifyFilter
  currentUserId: string | undefined
}) {
  const { identity, run, findingsRun } = group
  const retry = useCreateVerificationRun(group.documentId)
  const findings = useVerificationFindings(findingsRun?.id ?? null)
  const undismiss = useUndismissVerificationFinding(findingsRun?.id ?? '')
  const [dismissing, setDismissing] = useState<VerificationFindingView | null>(
    null,
  )
  // Matches are the bulk of a healthy run and the least urgent to read, so they
  // are folded behind one line rather than pushing the findings that need a
  // person off the first screen.
  const [matchesShown, setMatchesShown] = useState(false)
  const filename =
    identity.status === 'available'
      ? identity.filename
      : identity.status === 'pending'
        ? 'Loading document…'
        : 'Document unavailable'
  const checkedNumber = findingsRun
    ? checkedVersionNumber(identity, findingsRun)
    : undefined
  const currentNumber =
    identity.status === 'available' ? identity.currentVersionNumber : undefined
  const summary = findingsRun
    ? verificationSummaryCounts(findingsRun.summary)
    : null
  const documentLabel = `${filename}${checkedNumber === undefined ? '' : ` · version ${String(checkedNumber)}`}`

  const shown = sortFindings(
    findings.findings.filter((finding) =>
      findingMatchesFilter(finding, filter),
    ),
  )
  const matches =
    filter === 'all' || filter === 'match'
      ? shown.filter((finding) => finding.state === 'clear')
      : []
  const openFindings = shown.filter((finding) => finding.state !== 'clear')
  const matchCount = summary?.matched ?? matches.length
  const loadingFindings = findingsRun != null && findings.isPending
  const retryable =
    identity.status === 'available' &&
    identity.ready &&
    identity.currentVersionId != null

  return (
    <section className="border-t border-line first:border-t-0">
      <div className="flex items-start gap-3 px-6 py-4">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-fill text-muted"
        >
          <FileText size={14} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <Link
              to="/matters/$matterId/documents/$documentId"
              params={{
                matterId: run.matterId,
                documentId: group.documentId,
              }}
              className="min-w-0 truncate text-item text-ink hover:text-brand"
            >
              {filename}
            </Link>
            <span className="text-caption text-subtle">
              {verificationRunTime(run)}
            </span>
          </div>
          <p className="text-caption text-muted">
            {runStateSentence(run, summary)}
          </p>
          {findingsRun && findingsRun.id === run.id ? (
            <p className="text-caption text-subtle">
              {verificationVersionNote(checkedNumber, currentNumber)}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Link
            to="/matters/$matterId/documents/$documentId"
            params={{
              matterId: run.matterId,
              documentId: group.documentId,
            }}
            className="inline-flex items-center gap-1 text-caption font-medium text-brand hover:text-brand-pressed"
          >
            Open document
            <ArrowSquareOut size={12} aria-hidden="true" />
          </Link>
          {run.status === 'failed' || run.stale ? (
            <Button
              variant="secondary"
              size="sm"
              loading={retry.isPending}
              disabled={!retryable || retry.isPending}
              onClick={() => {
                if (identity.status !== 'available') return
                if (identity.currentVersionId) {
                  retry.mutate(identity.currentVersionId)
                }
              }}
            >
              {run.status === 'failed' ? 'Retry Verify' : 'Run again'}
            </Button>
          ) : null}
        </div>
      </div>

      {retry.error ? (
        <p className="px-6 pb-4 text-meta text-danger" role="alert">
          The run was not started. {retry.error.message}
        </p>
      ) : null}

      {undismiss.error ? (
        <p className="px-6 pb-4 text-meta text-danger" role="alert">
          The finding was not reopened. {undismiss.error.message}
        </p>
      ) : null}

      {run.status === 'failed' || run.status === 'queued' ? (
        <div className="px-6 pb-4">
          <div
            className={cn(
              'flex items-start gap-2 rounded-md px-3 py-2 text-meta',
              run.status === 'failed'
                ? 'bg-status-danger-soft text-ink'
                : 'bg-fill text-ink',
            )}
          >
            {run.status === 'failed' ? (
              <Warning
                size={14}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-danger"
              />
            ) : (
              <Clock
                size={14}
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-info"
              />
            )}
            <span>
              <span className="block text-ink">
                {run.status === 'failed'
                  ? verificationFailureTitle(
                      run.failureCode ?? 'execution_failed',
                    )
                  : 'Waiting to start'}
              </span>
              <span className="text-muted">
                {run.status === 'failed'
                  ? `${verificationFailureLabel(
                      run.failureCode ?? 'execution_failed',
                    )} The run was bound to ${failedVersionLabel(run, identity)}.`
                  : 'The run is queued and has not begun checking yet. You can leave this page.'}
              </span>
            </span>
          </div>
        </div>
      ) : null}

      {findingsRun && findingsRun.id !== run.id && run.status === 'failed' ? (
        <p className="px-6 pb-4 text-caption text-subtle">
          The findings below come from the earlier completed run on{' '}
          {checkedNumber === undefined
            ? 'an earlier version'
            : `version ${String(checkedNumber)}`}
          , completed{' '}
          {formatRunTime(findingsRun.completedAt ?? findingsRun.createdAt)}. The
          failed run above recorded no result.
        </p>
      ) : null}

      {findingsRun ? (
        loadingFindings ? (
          <p className="px-6 pb-4 text-meta text-muted" role="status">
            Loading findings…
          </p>
        ) : findings.isError ? (
          <div className="flex flex-wrap items-center gap-2 px-6 pb-4 text-meta text-danger">
            <span>Could not load every finding: {findings.error.message}</span>
            <Button
              variant="secondary"
              size="sm"
              loading={findings.isFetchingNextPage}
              onClick={() => void findings.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : shown.length > 0 ? (
          <div className="flex flex-col">
            {openFindings.map((finding) => (
              <VerifyFinding
                key={finding.id}
                finding={finding}
                currentUserId={currentUserId}
                checkedLabel={`Checked ${formatRunTime(
                  findingsRun.completedAt ?? findingsRun.createdAt,
                )}`}
                onDismiss={() => setDismissing(finding)}
                onUndismiss={() => undismiss.mutate(finding.id)}
              />
            ))}
            {matches.length > 0 ? (
              <div className="border-t border-line px-6 py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={matchesShown}
                  onClick={() => setMatchesShown((shown) => !shown)}
                >
                  {`${String(matchCount)} ${matchCount === 1 ? 'matches' : 'match'} the checked source`}
                  <span aria-hidden="true">·</span>
                  {matchesShown ? 'Hide' : 'Show'}
                </Button>
              </div>
            ) : null}
            {matchesShown
              ? matches.map((finding) => (
                  <VerifyFinding
                    key={finding.id}
                    finding={finding}
                    currentUserId={currentUserId}
                    checkedLabel={`Checked ${formatRunTime(
                      findingsRun.completedAt ?? findingsRun.createdAt,
                    )}`}
                    onDismiss={() => setDismissing(finding)}
                  />
                ))
              : null}
          </div>
        ) : (
          <p className="px-6 pb-4 text-meta text-muted">
            Nothing in this filter for this document.
          </p>
        )
      ) : null}

      {findingsRun && findings.hasNextPage && !findings.isError ? (
        <div className="flex flex-wrap items-center gap-3 px-6 pb-5">
          <Button
            variant="ghost"
            size="sm"
            loading={findings.isFetchingNextPage}
            onClick={() => void findings.fetchNextPage()}
          >
            Load more findings
          </Button>
          <span className="text-caption text-subtle">
            Showing the first {findings.findings.length} of{' '}
            {findingsRun.summary.findingCount} findings.
          </span>
        </div>
      ) : null}

      {dismissing ? (
        <VerifyDismissDialog
          finding={dismissing}
          runId={findingsRun?.id ?? run.id}
          documentLabel={documentLabel}
          open
          onOpenChange={(open) => {
            if (!open) setDismissing(null)
          }}
        />
      ) : null}
    </section>
  )
}

/** The version a failed run was bound to, in words. */
function failedVersionLabel(
  run: VerificationRun,
  identity: RunDocumentIdentity,
) {
  const number =
    identity.status === 'available'
      ? identity.versionNumbers.get(run.documentVersionId)
      : undefined
  return number === undefined
    ? 'the stored version'
    : `version ${String(number)}`
}

/** The run's state as a sentence, from the summary the server computed. */
function runStateSentence(
  run: VerificationRun,
  summary: ReturnType<typeof verificationSummaryCounts> | null,
) {
  switch (run.status) {
    case 'queued':
      return 'Queued. Nothing has been checked yet.'
    case 'running':
      return 'Checking citations, authorities and quotations against stored sources. You can leave this page.'
    case 'failed':
      return 'Run stopped. The run recorded no result.'
    case 'completed':
      return summary ? verificationCountsLabel(summary) : 'Completed.'
    default: {
      const unhandled: never = run.status
      return unhandled
    }
  }
}
