import { Button } from '@obiter/ui'

/**
 * The citation a source page carried into this document, waiting for a place
 * to go. The bar states what will happen and asks for the one thing only the
 * reader knows — where the sentence is — then inserts on request. It never
 * inserts on its own and never picks a position: an authority dropped at an
 * arbitrary point is worse than one not inserted.
 *
 * It is a form so Enter from the bar inserts, and the buttons are ordinary
 * controls so a keyboard reader reaches them without leaving the document's
 * flow. Insert is refused until a paragraph is selected, because the caret is
 * the position.
 */
export function PendingCitationBar({
  citation,
  canInsert,
  onInsert,
  onCancel,
}: {
  citation: string
  /** False until the reader has placed the caret in a paragraph. */
  canInsert: boolean
  onInsert: () => void
  onCancel: () => void
}) {
  return (
    <form
      aria-label="Pending citation"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-warning-soft px-3 py-2 text-caption text-ink"
      onSubmit={(event) => {
        event.preventDefault()
        if (canInsert) onInsert()
      }}
    >
      <span>Place the cursor where the citation goes</span>
      <span className="min-w-0 truncate text-muted">{citation}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!canInsert}
          title={
            canInsert ? undefined : 'Click in the document to place the cursor.'
          }
        >
          Insert
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    </form>
  )
}
