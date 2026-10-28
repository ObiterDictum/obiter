import { useRef, useState, type ReactNode } from 'react'
import { Clock, Info, ListChecks, Warning } from '@phosphor-icons/react'
import { Button, Skeleton, StatusDot } from '@obiter/ui'
import type { VerificationFindingView } from '@obiter/contracts'
import { ApiError } from '../../api'
import {
  verificationCountsLabel,
  verificationFailureLabel,
  verificationFailureTitle,
  verificationFindingCounts,
  verificationRunTime,
  verificationSummaryCounts,
  verificationStateLabel,
  verificationStoredVersionNote,
  verificationTypeLabel,
  verificationVersionNote,
} from '../../verification-copy'
import {
  useVerificationWorkspace,
  verificationDockId,
  type VerificationWorkspaceValue,
} from './verification-context'
import { nextActionableIndex } from './verification-mapping'
import { VerificationFindingsIndex } from './verification-findings-index'
import { VerifyDismissDialog } from './verify-dismiss-dialog'

/** The docked panel's state in the same words the header chip uses. */
function dockState(verification: VerificationWorkspaceValue) {
  const { run } = verification
  // Starting a run is visible before the run row comes back: the request is
  // the only thing that exists until the server answers.
  if (verification.startPending) {
    return { label: 'Checking…', tone: 'info' as const }
  }
  if (!run) return { label: 'Not checked', tone: 'neutral' as const }
  const counts = verificationSummaryCounts(run.summary)
  if (run.status === 'queued' || run.status === 'running') {
    return { label: 'Checking…', tone: 'info' as const }
  }
  if (run.status === 'failed') {
    return { label: 'Run stopped', tone: 'danger' as const }
  }
  if (verification.stale) {
    return { label: 'Check out of date', tone: 'warning' as const }
  }
  // A finished run whose every finding is unchecked established nothing. It is
  // not a clean result and must not be worded as one.
  if (counts.total > 0 && counts.notChecked === counts.total) {
    return { label: 'Nothing checked', tone: 'warning' as const }
  }
  const tone =
    counts.flagged > 0
      ? ('danger' as const)
      : counts.needsReview > 0 || counts.notChecked > 0
        ? ('warning' as const)
        : ('success' as const)
  return { label: 'Checked', tone }
}

/**
 * The document's Verify panel. It states what was checked and against which
 * version, what is still a person's decision, and the one action that follows —
 * then lists the run's findings in the same words the Verify page uses. The
 * engine, the run and the findings are untouched: this is the presentation
 * boundary over the same API.
 */
export function VerificationDock({
  panel = false,
  currentUserId,
}: {
  panel?: boolean
  /** The signed-in user, so a dismissal can say "you" truthfully. */
  currentUserId?: string
}) {
  const verification = useVerificationWorkspace()
  const statusRef = useRef<HTMLParagraphElement>(null)
  const [dismissing, setDismissing] = useState<VerificationFindingView | null>(
    null,
  )

  if (!verification) return null
  if (verification.runsPending) {
    return (
      <VerificationFrame panel={panel}>
        <Skeleton className="h-5 w-64" aria-label="Loading verification" />
      </VerificationFrame>
    )
  }
  if (verification.documentLost) {
    return (
      <VerificationFrame panel={panel}>
        <p className="text-meta text-muted">
          Verification is unavailable: you no longer have access to this
          document, or your session has expired.
        </p>
      </VerificationFrame>
    )
  }
  if (verification.runsError) {
    return (
      <VerificationFrame panel={panel}>
        <p className="text-meta text-danger">
          Verification runs are unavailable: {verification.runsError.message}
        </p>
      </VerificationFrame>
    )
  }

  const { run, findings } = verification
  // The counts come from the run summary the server computed over every
  // finding, so a page that failed to load cannot make the run look smaller.
  const counts = run
    ? verificationSummaryCounts(run.summary)
    : verificationFindingCounts(findings)
  const nextIndex = nextActionableIndex(findings)
  const nextFinding = nextIndex >= 0 ? findings[nextIndex] : undefined
  const busy =
    verification.startPending ||
    run?.status === 'queued' ||
    run?.status === 'running'
  const state = dockState(verification)
  const stateLabel =
    state.label === 'Checked' && verification.checkedVersionNumber
      ? `Checked · version ${String(verification.checkedVersionNumber)}`
      : state.label
  // Name the version by number when the document is loaded, and fall back to
  // the stored version id otherwise: an unnamed check is not an honest one.
  const versionNote = run
    ? verification.checkedVersionNumber !== undefined &&
      verification.currentVersionNumber !== undefined
      ? verificationVersionNote(
          verification.checkedVersionNumber,
          verification.currentVersionNumber,
        )
      : verificationStoredVersionNote(
          verification.checkedVersionId ?? 'unknown',
          {
            unsaved: verification.dirty,
            stale: verification.stale,
          },
        )
    : null
  const statusMessage = !run
    ? 'Verification has not been started for this stored version.'
    : busy
      ? 'Verification is running against the stored version.'
      : run.status === 'failed'
        ? `Run stopped. ${run.failureCode ? verificationFailureLabel(run.failureCode) : ''}`
        : `${stateLabel}. ${verificationCountsLabel(counts)}.`

  const runButton = (
    <Button
      ref={verification.setStartAnchor}
      size="sm"
      variant={panel ? 'primary' : 'secondary'}
      disabled={
        !verification.ready || verification.startPending || verification.dirty
      }
      loading={verification.startPending}
      onClick={() => {
        verification.startRun()
        statusRef.current?.focus()
      }}
    >
      {run?.status === 'failed'
        ? 'Retry Verify'
        : run?.status === 'completed'
          ? 'Run again'
          : 'Run Verify'}
    </Button>
  )

  return (
    <VerificationFrame panel={panel}>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusDot tone={state.tone} className="text-item">
            {stateLabel}
          </StatusDot>
          {run?.status === 'completed'
            ? counts.total > 0 && (
                <span className="text-meta text-muted">
                  {verificationCountsLabel(counts)}
                </span>
              )
            : null}
          {run ? (
            <span className="ml-auto text-caption text-subtle">
              {verificationRunTime(run)}
            </span>
          ) : null}
        </div>

        {versionNote ? (
          <p className="text-caption text-subtle">{versionNote}</p>
        ) : null}

        {!run ? (
          <p className="text-meta text-muted">
            <span className="text-ink">Not checked.</span>{' '}
            {verification.ready
              ? 'Run Verify to compare citations, authorities and quotations with the stored sources.'
              : 'This document must finish processing before it can be verified.'}
          </p>
        ) : null}

        {busy ? (
          <p
            className="flex items-start gap-2 text-meta text-muted"
            role="status"
          >
            <Clock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              Checking citations, authorities and quotations against the stored
              sources. You can leave this page; the result stays with the
              version.
            </span>
          </p>
        ) : null}

        {run?.status === 'failed' ? (
          <div className="flex items-start gap-2 rounded-md bg-status-danger-soft px-3 py-2 text-caption">
            <Warning
              size={14}
              aria-hidden="true"
              className="mt-0.5 shrink-0 text-danger"
            />
            <span>
              <span className="block text-ink">
                {verificationFailureTitle(
                  run.failureCode ?? 'execution_failed',
                )}
              </span>
              <span className="text-muted">
                {verificationFailureLabel(
                  run.failureCode ?? 'execution_failed',
                )}
              </span>
            </span>
          </div>
        ) : null}

        {nextFinding && !busy && run?.status === 'completed' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-fill px-3 py-2 text-caption">
            <span className="min-w-0 text-muted">
              <span className="text-ink">Next finding</span> ·{' '}
              {verificationTypeLabel(nextFinding.type)} ·{' '}
              {verificationStateLabel(nextFinding)}
              <span className="block truncate">
                {nextFinding.authorityLabel}
              </span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => verification.openFinding(nextFinding.id)}
            >
              Go to finding
            </Button>
          </div>
        ) : null}

        {panel ? (
          <p className="flex items-start gap-2 text-caption text-subtle">
            <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />A
            match is not legal approval. Every finding is a decision for a
            lawyer, and a check that did not run is not a pass.
          </p>
        ) : null}

        {run?.status === 'completed' && counts.dismissed > 0 ? (
          <p className="flex items-start gap-2 text-caption text-subtle">
            <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            Dismissed findings stay in the run with the result the check
            recorded. Dismissing never changes the document.
          </p>
        ) : null}

        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {statusMessage}
        </p>

        {verification.dirty ? (
          <p className="text-caption text-warning" role="note">
            Save before verification: the check reads the stored version, so
            unsaved edits are not covered by this evidence.
          </p>
        ) : null}

        {verification.findingsError ? (
          <div
            role="alert"
            data-verification-controls
            className="flex flex-wrap items-center gap-2 text-caption text-danger"
          >
            <span>
              Could not load every finding: {verification.findingsError.message}
            </span>
            <Button
              variant="secondary"
              size="sm"
              loading={verification.loadingMore}
              onClick={verification.retryFindings}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {verification.startError ? (
          <p className="text-caption text-danger" role="alert">
            {verification.startError instanceof ApiError &&
            verification.startError.code === 'forbidden'
              ? 'You do not have permission to start verification on this document.'
              : verification.startError.message}
          </p>
        ) : null}

        {verification.findingsPending && verification.findings.length === 0 ? (
          <Skeleton className="h-4 w-full" aria-label="Loading findings" />
        ) : null}

        {run?.status === 'completed' &&
        findings.length === 0 &&
        !verification.findingsError &&
        !verification.hasNextPage ? (
          <p className="text-meta text-muted">
            This run finished and found nothing to list. That is not a statement
            of legal correctness.
          </p>
        ) : null}
      </div>

      <div
        ref={(element) => verification.setDockAnchor(element)}
        data-verification-controls
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
        {runButton}
        <Button
          variant="secondary"
          size="sm"
          disabled={!run || verification.findings.length === 0}
          onClick={() => verification.openIndex()}
          iconStart={<ListChecks size={14} aria-hidden />}
        >
          All findings
        </Button>
      </div>

      {/* Rendered only while open: the index reads the signed-in user, and a
          closed dialog must not add a query to the workspace. */}
      {verification.indexOpen ? (
        <VerificationFindingsIndex
          open
          onOpenChange={(open) =>
            open ? verification.openIndex() : verification.closeIndex()
          }
          onDismiss={setDismissing}
          currentUserId={currentUserId}
        />
      ) : null}

      {dismissing && run ? (
        <VerifyDismissDialog
          finding={dismissing}
          runId={run.id}
          documentLabel={
            verification.checkedVersionNumber
              ? `Checked version ${String(verification.checkedVersionNumber)}`
              : 'Checked stored version'
          }
          open
          onOpenChange={(open) => {
            if (!open) setDismissing(null)
          }}
        />
      ) : null}
    </VerificationFrame>
  )
}

function VerificationFrame({
  children,
  panel,
}: {
  children: ReactNode
  panel: boolean
}) {
  return (
    <section
      id={verificationDockId}
      tabIndex={-1}
      aria-label="Verification"
      className={
        panel
          ? 'flex min-w-0 flex-col gap-4 focus:outline-none'
          : 'flex items-center gap-x-3 overflow-x-auto border-b border-line bg-surface px-12 py-1.5 whitespace-nowrap focus:outline-2 focus:outline-offset-2 focus:outline-brand max-compact:px-8'
      }
    >
      {children}
    </section>
  )
}
