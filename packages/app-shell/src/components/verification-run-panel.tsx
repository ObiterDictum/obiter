import { useRef } from 'react'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import { useDocument } from '../documents'
import {
  verificationFailureLabel,
  verificationOutcomeAnnouncement,
  verificationOutcomeLabel,
  verificationOutcomeTone,
  verificationRunStatusLabel,
} from '../verification-copy'
import {
  latestVerificationRun,
  useCreateVerificationRun,
  useDocumentVerificationRuns,
  useVerificationFindings,
} from '../verification-runs'
import { VerificationFindingsList } from './verification-findings'
import { useDocumentDraftStatus } from './document-workspace/document-draft-status'
import { ApiError } from '../api'

function statusTone(status: 'queued' | 'running' | 'completed' | 'failed') {
  if (status === 'failed') return 'danger' as const
  if (status === 'queued' || status === 'running') return 'info' as const
  // Completion is a separate axis from the finding outcome, which carries its
  // own tone and label below. A completed run is never painted as a success
  // here while its outcome badge may be a warning or danger.
  return 'neutral' as const
}

export function VerificationRunPanel({ documentId }: { documentId: string }) {
  const document = useDocument(documentId)
  const runs = useDocumentVerificationRuns(documentId)
  const create = useCreateVerificationRun(documentId)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const version = document.data?.document.currentVersion
  const draftStatus = useDocumentDraftStatus()
  const unsaved = draftStatus?.dirty ?? false
  const latest = latestVerificationRun(runs.data?.runs ?? [])
  const findings = useVerificationFindings(
    latest && latest.status === 'completed' ? latest.id : null,
  )
  const ready = version?.documentStatus === 'ready'
  const permissionLost = document.isError
  const checkedVersionId = latest?.documentVersionId ?? version?.id
  const startRun = () => {
    if (!ready || !version || create.isPending || unsaved) return
    create.mutate(version.id, {
      onSuccess: () => statusRef.current?.focus(),
      onError: () => statusRef.current?.focus(),
    })
  }

  if (document.isPending || runs.isPending) {
    return <Skeleton className="h-24" aria-label="Loading verification" />
  }
  if (permissionLost) {
    return (
      <EmptyState
        title="Verification is unavailable"
        body="You no longer have access to this document, or your session has expired."
      />
    )
  }
  if (runs.isError) {
    return (
      <EmptyState
        title="Verification runs are unavailable"
        body={runs.error.message}
      />
    )
  }

  const run = latest
  const busy =
    create.isPending || run?.status === 'queued' || run?.status === 'running'
  const statusMessage = !run
    ? `Verification has not been started for the stored version ${checkedVersionId ?? ''}.`
    : busy
      ? `Verification is running against the stored version ${run.documentVersionId}.`
      : run.status === 'completed'
        ? `Completed. ${verificationOutcomeAnnouncement(run.summary)}`
        : run.status === 'failed'
          ? `Failed. ${run.failureCode ? verificationFailureLabel(run.failureCode) : ''}`
          : verificationRunStatusLabel(run.status)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p
          ref={statusRef}
          tabIndex={-1}
          role="status"
          aria-live="polite"
          className="text-sm text-muted outline-none"
        >
          {statusMessage}
          {draftStatus && unsaved
            ? ' Unsaved editor changes are not part of the stored version and are not verified.'
            : ''}
        </p>
        <Button
          size="sm"
          disabled={!ready || create.isPending || unsaved}
          loading={create.isPending}
          onClick={startRun}
        >
          Run verification
        </Button>
      </div>
      {unsaved ? (
        <p className="text-sm text-warning" role="note">
          Save before verification. The check reads the stored version, so
          unsaved edits would not be checked.
        </p>
      ) : null}
      {checkedVersionId ? (
        <p className="text-xs text-subtle">
          Stored version{' '}
          <span className="font-mono text-ink">{checkedVersionId}</span>
          {run?.stale ? ' (earlier than current)' : ''}
        </p>
      ) : null}
      <p className="text-xs text-subtle">
        Checks citations, authorities and quotations in the main document,
        footnotes and endnotes. Headers, footers and comments are not checked.
      </p>
      {create.error ? (
        <p className="text-sm text-danger">
          {create.error instanceof ApiError && create.error.code === 'forbidden'
            ? 'You do not have permission to start verification on this document.'
            : create.error.message}
        </p>
      ) : null}
      {!run ? (
        <EmptyState
          title="No verification runs yet"
          body={
            ready
              ? 'Start a run to check citations, held authorities, and quotations against stored sources.'
              : 'This document must finish processing before it can be verified.'
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
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
            {run.stale ? <Badge tone="warning">Earlier version</Badge> : null}
            {run.failureCode ? (
              <Badge tone="danger">
                {verificationFailureLabel(run.failureCode)}
              </Badge>
            ) : null}
          </div>
          {run.status === 'completed' ? (
            findings.isPending ? (
              <Skeleton className="h-24" aria-label="Loading findings" />
            ) : findings.isError ? (
              <EmptyState
                title="Findings are unavailable"
                body={findings.error.message}
              />
            ) : (
              <>
                <VerificationFindingsList findings={findings.findings} />
                {findings.hasNextPage ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={findings.isFetchingNextPage}
                    onClick={() => void findings.fetchNextPage()}
                  >
                    Load more findings
                  </Button>
                ) : null}
              </>
            )
          ) : null}
        </div>
      )}
    </div>
  )
}
