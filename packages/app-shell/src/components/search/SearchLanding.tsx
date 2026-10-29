import { Button, Card, CardBody, CardFoot, CardHead } from '@obiter/ui'
import type { SearchCourtShortcut } from './searchTypes'

const searchTips = [
  { label: 'Case name', example: 'Wood v Capita' },
  { label: 'Neutral citation', example: '[2017] UKSC 24' },
  { label: 'Keyword', example: 'no oral modification' },
]

export function SearchLanding({
  courtLabel,
  courtShortcuts,
  recentSearches,
  onCourtShortcut,
  onRecentSearch,
  onClearRecents,
}: {
  courtLabel: string
  courtShortcuts: SearchCourtShortcut[]
  recentSearches: string[]
  onCourtShortcut: (court: string) => void
  onRecentSearch: (query: string) => void
  onClearRecents: () => void
}) {
  return (
    <div className="grid items-start gap-6 wide:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="search-recent">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="search-recent" className="text-section text-ink">
              Recent searches
            </h2>
            {recentSearches.length > 0 ? (
              <Button variant="ghost" size="sm" onClick={onClearRecents}>
                Clear
              </Button>
            ) : null}
          </div>
          <Card>
            {recentSearches.length > 0 ? (
              <ul className="divide-y divide-line">
                {recentSearches.map((search) => (
                  <li key={search}>
                    <button
                      type="button"
                      className="flex min-h-row w-full items-center gap-3 px-6 py-4 text-left text-body text-ink hover:bg-hover"
                      onClick={() => onRecentSearch(search)}
                    >
                      {search}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="pt-6">
                <p className="text-meta text-muted">
                  Your recent queries appear here. They stay in this browser
                  session.
                </p>
              </CardBody>
            )}
          </Card>
        </section>

        <section aria-labelledby="search-courts">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 id="search-courts" className="text-section text-ink">
              Court shortcuts
            </h2>
            <span className="text-meta text-subtle">{courtLabel}</span>
          </div>
          <Card>
            <CardBody className="flex flex-wrap gap-2 pt-6">
              {courtShortcuts.map((shortcut) => (
                <Button
                  key={shortcut.code}
                  variant="secondary"
                  size="sm"
                  onClick={() => onCourtShortcut(shortcut.code)}
                >
                  {shortcut.label}
                </Button>
              ))}
            </CardBody>
            <CardFoot>
              <span>
                Search judgments across stored UK courts and tribunals.
              </span>
            </CardFoot>
          </Card>
          <p className="mt-3 max-w-[68ch] text-meta text-muted">
            Search judgments covers the records ingested so far, not every
            published judgment. Obiter holds the source text and links to the
            original.
          </p>
        </section>
      </div>

      <aside className="flex min-w-0 flex-col gap-6">
        <section aria-labelledby="search-tips">
          <div className="mb-4">
            <h2 id="search-tips" className="text-section text-ink">
              Try searching
            </h2>
          </div>
          <Card>
            <CardBody className="flex flex-col gap-3 pt-6">
              {searchTips.map((tip) => (
                <div key={tip.label} className="flex flex-col gap-0.5">
                  <span className="text-caption text-subtle">{tip.label}</span>
                  <span className="text-item text-ink">{tip.example}</span>
                </div>
              ))}
            </CardBody>
          </Card>
        </section>
        <Card>
          <CardHead title="Sources" />
          <CardBody>
            <p className="text-meta text-muted">
              Case law comes from The National Archives (Find Case Law) and
              legislation from legislation.gov.uk. Every result links to the
              source it came from.
            </p>
          </CardBody>
        </Card>
      </aside>
    </div>
  )
}
