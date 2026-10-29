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
} from '@obiter/ui'
import type { StructuralInsertOutcome } from '../../document-structure-toolbar'

export function InsertCrossReferenceDialog({
  open,
  onOpenChange,
  targets,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  targets: ReadonlyArray<{ id: string; label: string }>
  onInsert: (targetParagraphId: string) => StructuralInsertOutcome
}) {
  const [targetId, setTargetId] = useState<string>()
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
        <DialogCloseButton />
        <DialogTitle>Insert cross-reference</DialogTitle>
        <DialogDescription>
          Inserts a reference to the chosen paragraph at the cursor.
        </DialogDescription>
        <div
          role="listbox"
          aria-label="Reference target"
          className="flex max-h-64 flex-col overflow-y-auto rounded-md bg-fill"
        >
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="option"
              aria-selected={targetId === target.id}
              className={`truncate px-3 py-2 text-left text-meta hover:bg-fill-hover ${
                targetId === target.id ? 'bg-brand-soft' : ''
              }`}
              onClick={() => {
                setTargetId(target.id)
                setError(undefined)
              }}
            >
              {target.label}
            </button>
          ))}
          {targets.length === 0 ? (
            <p className="px-3 py-2 text-meta text-muted">
              No paragraphs to reference.
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose
            render={<Button type="button" variant="ghost" size="sm" />}
          >
            Cancel
          </DialogClose>
          <Button
            type="button"
            size="sm"
            disabled={!targetId}
            onClick={() => {
              if (!targetId) return
              const outcome = onInsert(targetId)
              if (outcome.inserted) {
                setTargetId(undefined)
                setError(undefined)
                onOpenChange(false)
                return
              }
              setError(outcome.reason)
            }}
          >
            Insert
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
