import { useRef, useState, type ReactNode } from 'react'
import { ListChecks } from '@phosphor-icons/react'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import { ApiError } from '../../api'
import {
  verificationFailureLabel,
  verificationOutcomeAnnouncement,
  verificationOutcomeLabel,
  verificationOutcomeTone,
  verificationRunStatusLabel,
  verificationStateLabel,
} from '../../verification-copy'
import { useVerificationWorkspace } from './verification-context'
import { nextActionableIndex } from './verification-mapping'
import { VerificationFindingsIndex } from './verification-findings-index'

function statusTone(status: 'queued' | 'running' | 'completed' | 'failed') {
  if (status === 'failed') return 'danger' as const
  if (status === 'queued' || status === 'running') return 'info' as const
  // Completion is a separate axis from the finding outcome, which carries its
  // own tone and label below.
  return 'neutral' as const
}

/**
 * The document-level Verify control: a compact strip above the document page
 * reporting what was checked, what needs attention, and where to go next.
 *
 * It replaces the bottom-heavy findings list as the primary interaction without
 * deleting it: the full list and its keyset pagination stay behind "View all
 * findings" as an index. Running stays disabled while the editor holds
 * unsaved work, and the stored version is always named.
 */
export function VerificationDock() {
  const verification = useVerificationWorkspace()
  const statusRef = useRef<HTMLParagraphElement>(null)
  const [indexOpen, setIndexOpen] = useState(false)
  const reopenPanel = useRef(false)

  if (!verification) return null
  if (verification.runsPending) {
    return (
      <VerificationStrip>
        <Skeleton className="h-5 w-64" aria-label="Loading verification" />
      </VerificationStrip>
    )
  }
  if (verification.documentLost) {
    return (
      <VerificationStrip>
        <p className="text-sm text-muted">
          Verification is unavailable: you no longer have access to this
          document, or your session has expired.
        </p>
      </VerificationStrip>
    )
  }
  if (verification.runsError) {
    return (
      <VerificationStrip>
        <p className="text-sm text-danger">
          Verification runs are unavailable: {verification.runsError.message}
        </p>
      </VerificationStrip>
    )
  }

  const { run } = verification
  const busy =
    verification.startPending ||
    run?.status === 'queued' ||
    run?.status === 'running'
  const findings = verification.findings
  const nextIndex = nextActionableIndex(findings)
  const nextFinding = nextIndex >= 0 ? findings[nextIndex] : undefined
  const stateCount = (state: 'clear' | 'flagged' | 'review_required') =>
    findings.filter((finding) => finding.state === state).length
  const statusMessage = !run
    ? 'Verification has not been started for this stored version.'
    : busy
      ? `Verification is running against the stored version ${run.documentVersionId}.`
      : run.status === 'completed'
        ? `Completed. ${verificationOutcomeAnnouncement(run.summary)}`
        : run.status === 'failed'
          ? `Failed. ${run.failureCode ? verificationFailureLabel(run.failureCode) : ''}`
          : verificationRunStatusLabel(run.status)

  return (
    <VerificationStrip>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="text-xs font-semibold tracking-wide text-ink uppercase">
            Verify
          </h2>
          {run ? (
            <Badge tone={statusTone(run.status)}>
              {verificationRunStatusLabel(run.status)}
            </Badge>
          ) : null}
          {run?.status === 'completed' ? (
            <Badge tone={verificationOutcomeTone(run.summary)}>
              {verificationOutcomeLabel(run.summary)}
            </Badge>
          ) : null}
          {verification.stale ? (
            <Badge tone="warning">Earlier version</Badge>
          ) : null}
          {run?.failureCode ? (
            <Badge tone="danger">
              {verificationFailureLabel(run.failureCode)}
            </Badge>
          ) : null}
          {run?.status === 'completed' ? (
            <span className="text-xs text-subtle">
              {stateCount('clear')} clear · {stateCount('flagged')} flagged ·{' '}
              {stateCount('review_required')} needs review
            </span>
          ) : null}
        </div>
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="text-sm text-muted outline-none"
        >
          {statusMessage}
          {verification.checkedVersionId ? (
            <>
              {' '}
              Stored version{' '}
              <span className="font-mono text-ink">
                {verification.checkedVersionId}
              </span>
              .
            </>
          ) : null}
        </p>
        {verification.dirty ? (
          <p className="text-xs text-warning" role="note">
            Save before verification: the check reads the stored version, so
            unsaved edits are not covered by this evidence.
          </p>
        ) : null}
        {nextFinding ? (
          <p className="text-xs text-subtle">
            Next actionable: {nextFinding.authorityLabel} —{' '}
            {verificationStateLabel(nextFinding.state)}
          </p>
        ) : null}
        {verification.findingsError ? (
          <p className="text-xs text-danger">
            Findings are unavailable: {verification.findingsError.message}
          </p>
        ) : null}
      </div>
      <div
        ref={(element) => verification.setDockAnchor(element)}
        data-verification-controls
        className="flex shrink-0 flex-wrap items-center gap-2"
      >
        {nextFinding ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => verification.openFinding(nextFinding.id)}
          >
            Go to next finding
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={!run}
          onClick={() => {
            // The index is a modal list, so the panel steps aside for it and
            // returns with the same finding selected when it closes.
            reopenPanel.current = verification.panelOpen
            setIndexOpen(true)
          }}
          iconStart={<ListChecks size={14} aria-hidden />}
        >
          View all findings
        </Button>
        <Button
          size="sm"
          disabled={
            !verification.ready ||
            verification.startPending ||
            verification.dirty
          }
          loading={verification.startPending}
          onClick={() => {
            verification.startRun()
            statusRef.current?.focus()
          }}
        >
          Run verification
        </Button>
      </div>
      {verification.startError ? (
        <p className="w-full text-sm text-danger">
          {verification.startError instanceof ApiError &&
          verification.startError.code === 'forbidden'
            ? 'You do not have permission to start verification on this document.'
            : verification.startError.message}
        </p>
      ) : null}
      {verification.findingsPending ? (
        <Skeleton className="w-full" aria-label="Loading findings" />
      ) : null}
      {run?.status === 'completed' && findings.length === 0 ? (
        <p className="w-full text-sm text-muted">
          This run finished and found nothing to list. That is not a statement
          of legal correctness.
        </p>
      ) : null}
      {!run ? (
        <div className="w-full">
          <EmptyState
            title="No verification runs yet"
            body={
              verification.ready
                ? 'Start a run to check citations, held authorities, and quotations against stored sources.'
                : 'This document must finish processing before it can be verified.'
            }
          />
        </div>
      ) : null}
      <VerificationFindingsIndex open={indexOpen} onOpenChange={setIndexOpen} />
    </VerificationStrip>
  )
}

function VerificationStrip({ children }: { children: ReactNode }) {
  return (
    <section
      aria-label="Verification"
      className="flex flex-wrap items-start gap-3 border-b border-line bg-surface px-3 py-2.5"
    >
      {children}
    </section>
  )
}
