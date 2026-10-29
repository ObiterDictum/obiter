import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from '@obiter/ui'
import { refocusCaret } from './document-actions'

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
        <DialogFooter>
          <DialogClose render={<Button variant="ghost">Cancel</Button>} />
          <Button
            variant="danger"
            loading={pending}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
