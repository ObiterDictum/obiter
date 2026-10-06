import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@obiter/ui'
import type { StructuralInsertOutcome } from '../../document-structure-toolbar'

/**
 * The cross-reference target chooser: every stored body paragraph, labelled
 * by its text. A target deleted between render and submit is refused by the
 * outcome and shown in place.
 */
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
        <DialogTitle>Insert cross-reference</DialogTitle>
        <DialogDescription>
          Inserts a reference to the chosen paragraph at the cursor.
        </DialogDescription>
        <div
          role="listbox"
          aria-label="Reference target"
          className="flex max-h-64 flex-col overflow-y-auto rounded-md border border-[#d8d4cc]"
        >
          {targets.map((target) => (
            <button
              key={target.id}
              type="button"
              role="option"
              aria-selected={targetId === target.id}
              className={`truncate px-3 py-2 text-left text-[13px] hover:bg-[#eef3fb] ${
                targetId === target.id ? 'bg-[#dbe7f8]' : ''
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
            <p className="px-3 py-2 text-[13px] text-[#6b6862]">
              No paragraphs to reference.
            </p>
          ) : null}
        </div>
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
