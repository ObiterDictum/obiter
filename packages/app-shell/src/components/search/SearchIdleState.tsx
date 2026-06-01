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
    <section className="legal-search-idle" aria-label="Search start points">
      <div className="legal-search-idle__section">
        <p className="legal-search-idle__eyebrow">Recent searches</p>
        {recentSearches.length > 0 ? (
          <div className="legal-search-idle__chips">
            {recentSearches.map((recentSearch) => (
              <button type="button" key={recentSearch} onClick={() => onRecentSearch(recentSearch)}>
                {recentSearch}
              </button>
            ))}
          </div>
        ) : (
          <p className="legal-search-idle__muted">Recent searches appear here for this session.</p>
        )}
      </div>

      <div className="legal-search-idle__grid">
        <div className="legal-search-idle__section">
          <p className="legal-search-idle__eyebrow">Search tips</p>
          <ul className="legal-search-idle__tips">
            {searchTips.map((tip) => (
              <li key={tip.label}>
                <span>{tip.label}</span>
                <strong>{tip.example}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className="legal-search-idle__section">
          <p className="legal-search-idle__eyebrow">Court shortcuts</p>
          <div className="legal-search-idle__chips">
            {courtShortcuts.map((shortcut) => (
              <button type="button" key={shortcut.code} onClick={() => onCourtShortcut(shortcut.code)}>
                {shortcut.label}
              </button>
            ))}
          </div>
          <p className="legal-search-idle__muted">
            {courtLabel === 'All courts and tribunals'
              ? 'Choose a court, then enter a search term.'
              : `Filtering by ${courtLabel}. Enter a search term to search within that court.`}
          </p>
        </div>
      </div>
    </section>
  )
}
