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

export function InsertAuthorityDialog({
  open,
  onOpenChange,
  disabled,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  onInsert: (citation: string) => void
}) {
  const [citation, setCitation] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogTitle>Insert authority</DialogTitle>
        <DialogDescription>
          Inserts the citation at the caret. This does not look the authority
          up.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const next = citation.trim()
            if (!next || disabled) return
            onInsert(next)
            setCitation('')
            onOpenChange(false)
          }}
        >
          <Input
            label="Neutral citation"
            value={citation}
            onChange={(event) => setCitation(event.target.value)}
            placeholder="[2024] UKSC 3"
            disabled={disabled}
          />
          <div className="flex justify-end gap-2">
            <DialogClose
              render={<Button type="button" variant="ghost" size="sm" />}
            >
              Cancel
            </DialogClose>
            <Button
              type="submit"
              size="sm"
              disabled={disabled || !citation.trim()}
            >
              Insert
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
