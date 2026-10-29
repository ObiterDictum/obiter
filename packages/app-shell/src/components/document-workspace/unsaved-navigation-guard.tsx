import { useBlocker, useRouter } from '@tanstack/react-router'
import {
  Button,
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@obiter/ui'

export function UnsavedNavigationGuard({ atRisk }: { atRisk: boolean }) {
  const router = useRouter({ warn: false })
  return router ? <NavigationGuard atRisk={atRisk} /> : null
}

function NavigationGuard({ atRisk }: { atRisk: boolean }) {
  const blocker = useBlocker({
    shouldBlockFn: () => atRisk,
    enableBeforeUnload: atRisk,
    withResolver: true,
  })
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
          This browser could not store a draft. Leaving now would lose your
          unsaved changes. Stay to save them, or leave without saving.
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
