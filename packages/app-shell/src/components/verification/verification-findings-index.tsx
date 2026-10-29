import { useState } from 'react'
import type { VerificationFindingView } from '@obiter/contracts'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@obiter/ui'
import {
  formatRunTime,
  verificationStoredVersionNote,
  verificationUnmappedLabel,
} from '../../verification-copy'
import type { UnmappedReason } from './verification-mapping'
import { VerifyDismissDialog } from './verify-dismiss-dialog'
import { VerifyFinding } from './verify-finding'
import { useVerificationWorkspace } from './verification-context'

/**
 * Every finding in the open document's run, including the ones the page cannot
 * mark beside the text, each with the reason it is not drawn there. It reads the
 * same run and the same words as the Verify page, so a finding dismissed here is
 * dismissed there.
 */
export function VerificationFindingsIndex({
  open,
  onOpenChange,
  onDismiss,
  currentUserId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When the parent renders the dismiss dialog itself, hand the finding up. */
  onDismiss?: (finding: VerificationFindingView) => void
  currentUserId?: string
}) {
  const verification = useVerificationWorkspace()
  const [dismissing, setDismissing] = useState<VerificationFindingView | null>(
    null,
  )
  if (!verification || !verification.run) return null

  const notes = new Map<string, string>()
  for (const finding of verification.findings) {
    const target = verification.targets.get(finding.id)
    const reason: UnmappedReason | null = !verification.mappable
      ? 'document_not_mappable'
      : target?.kind === 'unmapped'
        ? target.reason
        : target?.kind === 'mapped' &&
            verification.rendered &&
            !verification.rendered.visibleIds.has(finding.id)
          ? (verification.rendered.reasons.get(finding.id) ??
            'text_changed_since_check')
          : null
    if (reason) notes.set(finding.id, verificationUnmappedLabel(reason))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[80vh] overflow-y-auto p-0">
        <div className="px-6 pt-6">
          <DialogTitle>All findings</DialogTitle>
          <DialogDescription>
            {verificationStoredVersionNote(verification.checkedVersionNumber, {
              unsaved: verification.dirty,
              stale: verification.stale,
            })}{' '}
            Checks cover the main document, footnotes and endnotes. Headers,
            footers and comments are not checked.
          </DialogDescription>
        </div>

        {verification.findingsError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 px-6 py-3 text-meta text-danger"
          >
            <span>
              Could not load every finding: {verification.findingsError.message}
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={verification.loadingMore}
              onClick={verification.retryFindings}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {verification.findingsPending && verification.findings.length === 0 ? (
          <p className="px-6 py-3 text-meta text-muted">Loading findings…</p>
        ) : verification.findings.length === 0 ? (
          <p className="px-6 py-3 text-meta text-muted">
            This run finished and found nothing to list. That is not a statement
            of legal correctness.
          </p>
        ) : (
          <div className="flex flex-col pt-2">
            {verification.findings.map((finding) => (
              <div key={finding.id} className="flex flex-col">
                <VerifyFinding
                  finding={finding}
                  currentUserId={currentUserId}
                  checkedLabel={`Checked ${formatRunTime(
                    verification.run.completedAt ??
                      verification.run.createdAt,
                  )}`}
                  onDismiss={() => {
                    if (onDismiss) onDismiss(finding)
                    else setDismissing(finding)
                  }}
                  onOpen={() => {
                    verification.openFinding(finding.id)
                    onOpenChange(false)
                  }}
                />
                {notes.get(finding.id) ? (
                  <p className="px-6 pb-3 text-caption text-subtle" role="note">
                    {notes.get(finding.id)}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {verification.hasNextPage && !verification.findingsError ? (
          <div className="flex flex-wrap items-center gap-3 px-6 pb-4">
            <Button
              size="sm"
              variant="ghost"
              loading={verification.loadingMore}
              onClick={verification.loadMore}
            >
              Load more findings
            </Button>
            <span className="text-caption text-subtle">
              Showing the first {verification.findings.length} of{' '}
              {verification.totalFindings} findings.
            </span>
          </div>
        ) : null}

        <div className="flex justify-end px-6 pt-2 pb-6">
          <DialogClose render={<Button variant="ghost">Close</Button>} />
        </div>
      </DialogContent>

      {dismissing && verification.run ? (
        <VerifyDismissDialog
          finding={dismissing}
          runId={verification.run.id}
          documentLabel={
            verification.checkedVersionNumber
              ? `Checked version ${String(verification.checkedVersionNumber)}`
              : 'Checked stored version'
          }
          open
          onOpenChange={(next) => {
            if (!next) setDismissing(null)
          }}
        />
      ) : null}
    </Dialog>
  )
}
