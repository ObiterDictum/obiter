import type { DocumentOutlineEntry } from '../../document-outline'

/**
 * The navigation pane: the document's heading outline. Selecting an entry
 * places the caret at that heading — the same navigation the authority and
 * comment panels perform — so an outline row is a real document action, not
 * a link that only scrolls. A document without headings says so rather than
 * painting an empty frame.
 */
export function DocumentNavigationPane({
  entries,
  activeParagraphId,
  onSelect,
}: {
  entries: readonly DocumentOutlineEntry[]
  activeParagraphId: string | null
  onSelect: (paragraphId: string) => void
}) {
  return (
    <nav
      aria-label="Document outline"
      data-navigation-pane
      className="sticky top-0 max-h-[80vh] w-56 shrink-0 self-start overflow-y-auto rounded-md bg-surface ring-1 ring-line"
    >
      <p className="border-b border-line px-3 py-2 text-xs font-semibold tracking-wide text-muted uppercase">
        Navigation
      </p>
      {entries.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          No headings in this document. The outline lists paragraphs whose style
          carries a heading level.
        </p>
      ) : (
        <ul className="flex flex-col py-1">
          {entries.map((entry) => (
            <li key={entry.paragraphId} aria-level={entry.level}>
              <button
                type="button"
                data-outline-item
                aria-current={
                  entry.paragraphId === activeParagraphId ? 'true' : undefined
                }
                className="min-h-8 w-full truncate px-3 py-1.5 text-left text-sm text-ink hover:bg-raised aria-current:bg-raised aria-current:font-medium pointer-coarse:min-h-11"
                style={{
                  paddingLeft: `${12 + (Math.min(entry.level, 9) - 1) * 12}px`,
                }}
                onClick={() => onSelect(entry.paragraphId)}
              >
                {entry.text.trim().length > 0 ? entry.text : 'Untitled heading'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
