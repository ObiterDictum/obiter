import { Button } from '@obiter/ui'

export function PendingCitationBar({
  citation,
  canInsert,
  onInsert,
  onCancel,
}: {
  citation: string
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
