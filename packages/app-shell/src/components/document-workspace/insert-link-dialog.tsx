import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@obiter/ui'
import type { StructuralInsertOutcome } from '../../document-structure-toolbar'

/**
 * The address a pending hyperlink carries. The draft — and so the save —
 * rejects anything but an http, https or mailto URL, so a refused outcome is
 * shown in place rather than closing the dialog on a typo.
 */
export function InsertLinkDialog({
  open,
  onOpenChange,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onInsert: (target: string) => StructuralInsertOutcome
}) {
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string>()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(undefined)
        onOpenChange(next)
      }}
    >
      <DialogContent size="sm">
        <DialogTitle>Insert link</DialogTitle>
        <DialogDescription>
          Links the selected text to a web address or email.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const outcome = onInsert(target)
            if (outcome.inserted) {
              setTarget('')
              setError(undefined)
              onOpenChange(false)
              return
            }
            setError(outcome.reason)
          }}
        >
          <Input
            label="Address"
            type="url"
            placeholder="https://example.com"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value)
              setError(undefined)
            }}
          />
          {error ? (
            <p role="alert" className="text-[12px] text-[#9a4f3c]">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <DialogClose
              render={<Button type="button" variant="ghost" size="sm" />}
            >
              Cancel
            </DialogClose>
            <Button type="submit" size="sm" disabled={target.length === 0}>
              Insert
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
