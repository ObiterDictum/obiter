import { useRef } from 'react'
import { Badge, Button, EmptyState, Skeleton } from '@obiter/ui'
import { useDocument } from '../documents'
import {
  verificationFailureLabel,
  verificationRunStatusLabel,
} from '../verification-copy'
import {
  latestVerificationRun,
  useCreateVerificationRun,
  useDocumentVerificationRuns,
  useVerificationFindings,
} from '../verification-runs'
import { VerificationFindingsList } from './verification-findings'
import { ApiError } from '../api'

function statusTone(
  status: 'queued' | 'running' | 'completed' | 'failed',
  needsReview: boolean,
) {
  if (status === 'failed') return 'danger' as const
  if (status === 'queued' || status === 'running') return 'info' as const
  if (needsReview) return 'warning' as const
  return 'success' as const
}

export function VerificationRunPanel({ documentId }: { documentId: string }) {
  const document = useDocument(documentId)
  const runs = useDocumentVerificationRuns(documentId)
  const create = useCreateVerificationRun(documentId)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const version = document.data?.document.currentVersion
  const latest = latestVerificationRun(runs.data?.runs ?? [])
  const findings = useVerificationFindings(
    latest && latest.status === 'completed' ? latest.id : null,
  )
  const ready = version?.documentStatus === 'ready'
  const permissionLost = document.isError
  const startRun = () => {
    if (!ready || !version || create.isPending) return
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
  const needsReview = (run?.summary.reviewRequiredCount ?? 0) > 0
  const busy =
    create.isPending || run?.status === 'queued' || run?.status === 'running'

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
          {busy
            ? 'Verification is running against this document version.'
            : run
              ? `${verificationRunStatusLabel(run.status)}${
                  run.stale ? '. This run belongs to an earlier version.' : ''
                }`
              : 'Verification has not been started for this document version.'}
        </p>
        <Button
          size="sm"
          disabled={!ready || create.isPending}
          loading={create.isPending}
          onClick={startRun}
        >
          Run verification
        </Button>
      </div>
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
            <Badge
              tone={statusTone(
                run.status,
                needsReview && run.status === 'completed',
              )}
            >
              {run.status === 'completed' && needsReview
                ? 'Completed with review required'
                : verificationRunStatusLabel(run.status)}
            </Badge>
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
              <VerificationFindingsList
                findings={findings.data?.findings ?? []}
              />
            )
          ) : null}
        </div>
      )}
    </div>
  )
}
