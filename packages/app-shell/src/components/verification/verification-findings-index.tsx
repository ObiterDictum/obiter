import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@obiter/ui'
import { VerificationFindingsList } from '../verification-findings'
import {
  verificationUnmappedLabel,
  verificationStoredVersionNote,
} from '../../verification-copy'
import type { UnmappedReason } from './verification-mapping'
import { useVerificationWorkspace } from './verification-context'

/**
 * The full findings list, unchanged from V5 and kept behind "View all
 * findings". It is an index now, not the primary interaction: every finding is
 * listed with its evidence, including the ones the document cannot show beside
 * the text, each with the reason it is not shown.
 */
export function VerificationFindingsIndex({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const verification = useVerificationWorkspace()
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
      <DialogContent size="lg" className="max-h-[80vh] overflow-y-auto">
        <DialogTitle>All findings</DialogTitle>
        <DialogDescription>
          {verificationStoredVersionNote(
            verification.checkedVersionId ?? 'unknown',
            {
              unsaved: verification.dirty,
              stale: verification.stale,
            },
          )}{' '}
          Checks cover the main document, footnotes and endnotes. Headers,
          footers and comments are not checked.
        </DialogDescription>
        {verification.findingsError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-2 text-sm text-danger"
          >
            <span>
              Could not load every finding: {verification.findingsError.message}
            </span>
            <Button
              size="sm"
              variant="secondary"
              loading={verification.loadingMore}
              onClick={() => verification.retryFindings()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {verification.hasNextPage && !verification.findingsError ? (
          <p className="text-sm text-muted">
            Showing the first {verification.findings.length} of{' '}
            {verification.totalFindings} findings.
          </p>
        ) : null}
        {verification.findingsPending && verification.findings.length === 0 ? (
          <p className="text-sm text-muted">Loading findings…</p>
        ) : verification.findings.length > 0 || !verification.findingsError ? (
          <VerificationFindingsList
            findings={verification.findings}
            notes={notes}
            onSelectFinding={(findingId) => {
              verification.openFinding(findingId)
              onOpenChange(false)
            }}
          />
        ) : null}
        {verification.hasNextPage && !verification.findingsError ? (
          <div className="pt-3">
            <Button
              size="sm"
              variant="ghost"
              loading={verification.loadingMore}
              onClick={verification.loadMore}
            >
              Load more findings
            </Button>
          </div>
        ) : null}
        <div className="flex justify-end pt-4">
          <DialogClose render={<Button variant="ghost">Close</Button>} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
