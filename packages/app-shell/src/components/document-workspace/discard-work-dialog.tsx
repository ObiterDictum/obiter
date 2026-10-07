import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@obiter/ui'
import { refocusCaret } from './document-actions'

/**
 * Confirmation for discarding unsaved document work. Opening the dialog is
 * not destructive; only the confirm button is.
 */
export function DiscardWorkDialog({
  triggerLabel,
  title,
  body,
  confirmLabel,
  onConfirm,
}: {
  triggerLabel: string
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      setOpen(false)
      // The pending state disabled the focused confirm, so focus already
      // dropped to document.body; closing then restores to a trigger every
      // caller's confirm has just unmounted with its banner. Once the
      // dialog's own restore has run — a frame later — hand the stranded
      // focus to the caret rather than losing the next typed burst. A
      // surviving restore target (or a deliberate click elsewhere) wins.
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) refocusCaret()
      })
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'The discard did not finish. Your work is still here.',
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <DialogTrigger
        render={
          <Button variant="secondary" size="sm">
            {triggerLabel}
          </Button>
        }
      />
      <DialogContent size="md">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{body}</DialogDescription>
        {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            variant="danger"
            loading={pending}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </div>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
