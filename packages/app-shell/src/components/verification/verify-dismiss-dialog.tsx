import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  useToast,
} from '@obiter/ui'
import { Warning } from '@obiter/ui/icons'
import { ApiError } from '../../api'
import { useDismissVerificationFinding } from '../../verification-runs'
import { verificationStateLabel } from '../../verification-copy'
import type { VerificationFindingView } from '@obiter/contracts'

export function VerifyDismissDialog({
  finding,
  runId,
  documentLabel,
  open,
  onOpenChange,
}: {
  finding: VerificationFindingView
  runId: string
  documentLabel: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const dismiss = useDismissVerificationFinding(runId)
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const close = () => {
    if (dismiss.isPending) return
    onOpenChange(false)
    setReason('')
    dismiss.reset()
  }
  const submit = () => {
    const trimmed = reason.trim()
    dismiss.mutate(
      { findingId: finding.id, reason: trimmed.length > 0 ? trimmed : null },
      {
        onSuccess: () => {
          toast({
            title: 'Finding dismissed',
            description:
              'Saved with your name and the time. The document was not changed.',
            tone: 'success',
          })
          close()
        },
      },
    )
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close()
        else onOpenChange(true)
      }}
    >
      <DialogContent size="md">
        <DialogTitle>Dismiss this finding?</DialogTitle>
        <DialogDescription>
          {documentLabel} · {verificationStateLabel(finding)}
        </DialogDescription>
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-body text-muted">
            The finding stays in the run for everyone in the matter, with the
            result the check recorded. Dismissing records your decision; it does
            not change the document.
          </p>
          <label className="flex flex-col gap-2 text-item text-ink">
            Reason (optional)
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="For example: the paragraph is a direct quotation from the judgment."
              className="rounded-md border border-line bg-surface px-3 py-2 text-body text-ink"
            />
            <span className="text-caption text-subtle">
              Saved with your name and the time. At most 2,000 characters.
            </span>
          </label>
          {dismiss.error ? (
            <p
              className="flex items-start gap-2 text-meta text-danger"
              role="alert"
            >
              <Warning
                size={14}
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              />
              {dismiss.error instanceof ApiError &&
              dismiss.error.code === 'forbidden'
                ? 'You do not have permission to dismiss findings in this matter.'
                : `The dismissal was not saved. ${dismiss.error.message}`}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="secondary">Cancel</Button>} />
          <Button
            variant="primary"
            loading={dismiss.isPending}
            onClick={submit}
          >
            Dismiss finding
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
