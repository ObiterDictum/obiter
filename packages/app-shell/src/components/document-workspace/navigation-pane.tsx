import { X } from '@phosphor-icons/react'
import { Button } from '@obiter/ui'
import type { DocumentOutlineEntry } from '../../document-outline'

export function DocumentNavigationPane({
  entries,
  activeParagraphId,
  onSelect,
  onClose,
}: {
  entries: readonly DocumentOutlineEntry[]
  activeParagraphId: string | null
  onSelect: (paragraphId: string) => void
  onClose: () => void
}) {
  return (
    <nav
      aria-label="Document outline"
      data-navigation-pane
      data-docked-panel
      className="flex max-h-[80vh] w-64 shrink-0 flex-col self-start overflow-hidden rounded-lg bg-surface ring-1 ring-line"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
        <p className="text-item text-ink">Navigation</p>
        <Button
          variant="ghost"
          size="sm"
          className="size-7 px-0"
          aria-label="Close navigation"
          onClick={onClose}
          iconStart={<X size={14} aria-hidden />}
        />
      </div>
      {entries.length === 0 ? (
        <p className="px-4 py-3 text-caption text-muted">
          No headings in this document. The outline lists paragraphs whose style
          carries a heading level.
        </p>
      ) : (
        <ul className="flex flex-col overflow-y-auto py-1">
          {entries.map((entry) => (
            <li key={entry.paragraphId}>
              <button
                type="button"
                data-outline-item
                aria-current={
                  entry.paragraphId === activeParagraphId ? 'true' : undefined
                }
                className="min-h-8 w-full truncate px-3 py-1.5 text-left text-meta text-ink hover:bg-hover aria-current:bg-raised aria-current:font-medium pointer-coarse:min-h-11"
                style={{
                  paddingLeft: `${String(12 + (Math.min(entry.level, 9) - 1) * 12)}px`,
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
