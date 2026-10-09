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
import { classifyAuthorityInput } from '../../document-authorities'
import type { CitationStyle } from '../../document-preferences'

/**
 * Inserts an authority citation at the caret. The input is validated against
 * the same grammars Verify resolves, so an authority that cannot be resolved
 * is refused up front rather than written and silently uncheckable. An
 * unsupported court is inserted anyway with a warning: the citation is real
 * text the author may want, and Verify reports it for review rather than
 * calling it invalid.
 */
export function InsertAuthorityDialog({
  open,
  onOpenChange,
  disabled,
  citationStyle,
  onInsert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  disabled: boolean
  citationStyle: CitationStyle
  onInsert: (citation: string) => void
}) {
  const [citation, setCitation] = useState('')
  const [rejected, setRejected] = useState(false)
  const kind = classifyAuthorityInput(citation)
  const unsupported = kind === 'unsupported_court'
  const helper = unsupported
    ? 'This court is outside the grammars Verify resolves. The citation is still inserted; Verify reports it for review.'
    : citationStyle === 'house'
      ? 'House style is active: the citation is inserted in italics.'
      : undefined
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogTitle>Insert authority</DialogTitle>
        <DialogDescription>
          Inserts the citation at the caret. Inserting does not look the
          authority up or check that it exists — Verify citations checks
          citations against the stored sources.
        </DialogDescription>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            const next = citation.trim()
            if (!next || disabled) return
            if (kind === 'invalid') {
              setRejected(true)
              return
            }
            onInsert(next)
            setCitation('')
            setRejected(false)
            onOpenChange(false)
          }}
        >
          <Input
            label="Citation"
            value={citation}
            onChange={(event) => {
              setCitation(event.target.value)
              setRejected(false)
            }}
            placeholder="[2024] UKSC 3 or /ln/ukpga/1998/42"
            disabled={disabled}
            helperText={rejected ? undefined : helper}
            error={
              rejected ? (
                <span role="alert">
                  That is not a citation this editor recognises. Use a neutral
                  citation like [2024] UKSC 3, or a legislation path like
                  /ln/ukpga/1998/42.
                </span>
              ) : undefined
            }
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
