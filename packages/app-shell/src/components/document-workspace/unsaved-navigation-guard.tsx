import { useBlocker, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@obiter/ui'
import type { SaveState } from './use-document-save'

export function UnsavedNavigationGuard({
  saveState,
}: {
  saveState: SaveState
}) {
  const router = useRouter({ warn: false })
  return router ? <NavigationGuard saveState={saveState} /> : null
}

function NavigationGuard({ saveState }: { saveState: SaveState }) {
  const atRisk = saveState.status !== 'saved'
  const blocker = useBlocker({
    shouldBlockFn: () => atRisk,
    enableBeforeUnload: atRisk,
    withResolver: true,
  })
  useEffect(() => {
    if (!atRisk && blocker.status === 'blocked') blocker.proceed()
  }, [atRisk, blocker.status, blocker.proceed])
  return (
    <Dialog
      open={blocker.status === 'blocked'}
      onOpenChange={(open) => {
        if (!open) blocker.reset?.()
      }}
    >
      <DialogContent size="md">
        <DialogTitle>Leave without saving?</DialogTitle>
        <DialogDescription>
          You have unsaved changes. Leaving now would lose them. Stay to save
          them, or leave without saving.
        </DialogDescription>
        <DialogFooter>
          <Button variant="ghost" onClick={() => blocker.reset?.()}>
            Stay
          </Button>
          <Button variant="danger" onClick={() => blocker.proceed?.()}>
            Leave without saving
          </Button>
        </DialogFooter>
        <DialogCloseButton />
      </DialogContent>
    </Dialog>
  )
}
