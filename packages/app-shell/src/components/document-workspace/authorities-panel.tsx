import { Button, EmptyState } from '@obiter/ui'

export function DocumentAuthoritiesPanel({
  citations,
  onSelect,
}: {
  citations: ReadonlyArray<{
    paragraphId: string
    citation: string
  }>
  onSelect: (paragraphId: string) => void
}) {
  return (
    <aside
      className="flex w-full flex-col gap-4 lg:max-w-sm"
      aria-label="Authorities"
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-ink">List of authorities</h3>
        <p className="text-xs leading-relaxed text-muted">
          Neutral citations found in this document. Existence and treatment are
          not checked.
        </p>
      </div>
      {citations.length === 0 ? (
        <EmptyState
          title="No citations found"
          body="UK and E&W neutral citations in the draft appear here."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {citations.map((item, index) => (
            <li key={`${item.paragraphId}-${item.citation}-${index}`}>
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => onSelect(item.paragraphId)}
              >
                {item.citation}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
