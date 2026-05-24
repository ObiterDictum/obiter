import { Link } from '@tanstack/react-router'
import type { LegalSearchFetchResponse } from './searchTypes'

interface SearchResultsProps {
  response: LegalSearchFetchResponse
}

export function SearchResults({ response }: SearchResultsProps) {
  return (
    <section className="legal-search__results" aria-live="polite">
      <p className="legal-search__meta">
        {response.cached ? 'Cached result' : 'Fetched and cached'} - {response.indexedCount} indexed - {response.skippedCount} skipped
      </p>
      {response.hits.map((result) => {
        return (
          <article className="case-law-result" key={result.id}>
            <Link
              to="/cases/$caseId"
              params={{ caseId: result.id }}
              className="case-law-result__summary"
            >
              <span>
                <strong>{result.title}</strong>
                <small>
                  {result.neutralCitation} - {result.court} - {result.dateDecided}
                </small>
              </span>
              <span className="case-law-result__actions">
                <span className="case-law-result__toggle">Open case</span>
                <span className="case-law-result__source">Stored source</span>
              </span>
            </Link>
          </article>
        )
      })}
    </section>
  )
}
