import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@obiter/ui'

export default function RequiredUpdateDialog({
  required,
  saving,
  saveFailed,
  onUpdate,
  onClose,
}: {
  required: boolean
  saving: boolean
  saveFailed: boolean
  onUpdate: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (required) details.cancel()
        else if (!open) onClose()
      }}
    >
      <DialogContent size="sm">
        <DialogTitle>
          {required ? 'Update required' : 'Update waiting'}
        </DialogTitle>
        <DialogDescription>
          {required
            ? 'Your organisation requires the latest version of Obiter.'
            : 'A new version of Obiter is ready.'}
        </DialogDescription>
        {saveFailed ? (
          <p role="alert">
            The update waits until your work is saved. Your changes could not be
            saved. Try again.
          </p>
        ) : null}
        <Button disabled={saving} onClick={onUpdate}>
          {saving ? 'Saving your work…' : 'Update now'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
