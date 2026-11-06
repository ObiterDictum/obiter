import { useRef } from 'react'
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@obiter/ui'
import { formatShortcut } from '../../keyboard-platform'
import type { ChangeReview } from './use-change-review'

export function BulkDecisionDialog({
  review,
  versionNumber,
}: {
  review: ChangeReview
  versionNumber?: number
}) {
  const pending = review.bulkConfirm
  const cancelRef = useRef<HTMLButtonElement>(null)
  const accepting = pending?.action === 'accept'
  const count = pending?.changeIds.length ?? 0
  const noun = count === 1 ? 'change' : 'changes'
  const supportedOnly = review.undecidableCount > 0
  const undecidable = supportedOnly
    ? ` ${review.undecidableCount} ${
        review.undecidableCount === 1 ? 'change' : 'changes'
      } cannot be decided here and will stay listed and unchanged.`
    : ''
  return (
    <Dialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) review.cancelBulkDecision()
      }}
    >
      <DialogContent size="sm" initialFocus={cancelRef}>
        <DialogTitle>
          {accepting ? 'Accept' : 'Reject'} all
          {supportedOnly ? ' supported' : ''} changes?
        </DialogTitle>
        <DialogDescription>
          {count} {noun} will be {accepting ? 'accepted' : 'rejected'}.
          {undecidable} This saves version {(versionNumber ?? 1) + 1} straight
          away and cannot be undone with {formatShortcut(['primary', 'Z'])}. The
          previous version can be restored from History.
        </DialogDescription>
        <DialogFooter>
          <Button
            ref={cancelRef}
            variant="ghost"
            size="sm"
            onClick={review.cancelBulkDecision}
          >
            Cancel
          </Button>
          <Button
            variant={accepting ? 'primary' : 'danger'}
            size="sm"
            disabled={review.pending || Boolean(review.unavailable)}
            title={review.unavailable ?? undefined}
            onClick={review.confirmBulkDecision}
          >
            {accepting ? 'Accept all' : 'Reject all'}
          </Button>
        </DialogFooter>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
