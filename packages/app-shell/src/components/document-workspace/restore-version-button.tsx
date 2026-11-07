import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogCloseButton,
} from '@obiter/ui'

export function RestoreVersionButton({
  versionNumber,
  disabledReason,
  onRestore,
}: {
  versionNumber: number
  disabledReason?: string
  onRestore: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        disabled={!!disabledReason}
        title={disabledReason}
        onClick={() => setOpen(true)}
      >
        Restore this version
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogTitle>Restore version {versionNumber}?</DialogTitle>
          <DialogDescription>
            Obiter saves it as a new version. The current version stays in
            History.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setOpen(false)
                onRestore()
              }}
            >
              Restore version
            </Button>
          </DialogFooter>
          <DialogCloseButton />
        </DialogContent>
      </Dialog>
    </>
  )
}
