export interface SearchCourtShortcut {
  code: string
  label: string
}

interface SearchIdleStateProps {
  courtLabel: string
  courtShortcuts: SearchCourtShortcut[]
  recentSearches: string[]
  onCourtShortcut: (court: string) => void
  onRecentSearch: (query: string) => void
}

const searchTips = [
  { label: 'Case name', example: 'Potanina v Potanin' },
  { label: 'Neutral citation', example: '[2024] UKSC 3' },
  { label: 'Keyword', example: 'beneficial ownership' },
]

export function SearchIdleState({
  courtLabel,
  courtShortcuts,
  recentSearches,
  onCourtShortcut,
  onRecentSearch,
}: SearchIdleStateProps) {
  return (
    <section className="grid gap-5 rounded-lg border border-line bg-surface p-5" aria-label="Search start points">
      <div className="flex flex-col gap-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Recent searches</p>
        {recentSearches.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {recentSearches.map((recentSearch) => (
              <button
                className="rounded-pill border border-line bg-canvas px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
                type="button"
                key={recentSearch}
                onClick={() => onRecentSearch(recentSearch)}
              >
                {recentSearch}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted">Recent searches appear here for this session.</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Search tips</p>
          <ul className="flex flex-col gap-2">
            {searchTips.map((tip) => (
              <li className="flex items-baseline gap-2.5" key={tip.label}>
                <span className="w-[104px] shrink-0 text-sm text-muted">{tip.label}</span>
                <strong className="text-sm font-semibold text-ink">{tip.example}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-subtle">Court shortcuts</p>
          <div className="flex flex-wrap gap-2">
            {courtShortcuts.map((shortcut) => (
              <button
                className="rounded-pill border border-line bg-canvas px-3 py-1.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand"
                type="button"
                key={shortcut.code}
                onClick={() => onCourtShortcut(shortcut.code)}
              >
                {shortcut.label}
              </button>
            ))}
          </div>
          <p className="text-sm leading-relaxed text-muted">
            {courtLabel === 'All courts and tribunals'
              ? 'Choose a court, then enter a search term.'
              : `Filtering by ${courtLabel}. Enter a search term to search within that court.`}
          </p>
        </div>
      </div>
    </section>
  )
}
