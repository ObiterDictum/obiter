import { Link } from '@tanstack/react-router'
import type { AtlasFetchResponse } from './atlasSearchTypes'

interface AtlasSearchResultsProps {
  response: AtlasFetchResponse
}

export function AtlasSearchResults({ response }: AtlasSearchResultsProps) {
  return (
    <section className="atlas-search__results" aria-live="polite">
      <p className="atlas-search__meta">
        {response.cached ? 'Cached result' : 'Fetched and cached'} - {response.indexedCount} indexed - {response.skippedCount} skipped
      </p>
      {response.hits.map((result) => {
        return (
          <article className="atlas-result" key={result.id}>
            <Link
              to="/cases/$caseId"
              params={{ caseId: result.id }}
              className="atlas-result__summary"
            >
              <span>
                <strong>{result.title}</strong>
                <small>
                  {result.neutralCitation} - {result.court} - {result.dateDecided}
                </small>
              </span>
              <span className="atlas-result__actions">
                <span className="atlas-result__toggle">Open case</span>
                <span className="atlas-result__source">Stored source</span>
              </span>
            </Link>
          </article>
        )
      })}
    </section>
  )
}
