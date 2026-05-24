import { Link } from '@tanstack/react-router'
import type { LegalSearchFetchResponse } from './searchTypes'

interface SearchResultsProps {
  response: LegalSearchFetchResponse
}

export function SearchResults({ response }: SearchResultsProps) {
  const storedResultsAvailable = response.cached || response.indexedCount > 0

  return (
    <section className="legal-search__results" aria-live="polite">
      <p className="legal-search__meta">
        {response.cached
          ? 'Stored result'
          : storedResultsAvailable
            ? 'Fetched and stored'
            : 'Fetched from Find Case Law'} - {response.indexedCount} indexed - {response.skippedCount} skipped
      </p>
      {response.hits.map((result) => {
        const summary = (
          <>
            <span>
              <strong>{result.title}</strong>
              <small>
                {result.neutralCitation} - {result.court} - {result.dateDecided}
              </small>
            </span>
            <span className="case-law-result__actions">
              <span className="case-law-result__toggle">
                {storedResultsAvailable ? 'Open case' : 'Open source'}
              </span>
              <span className="case-law-result__source">
                {storedResultsAvailable ? 'Stored source' : 'Find Case Law'}
              </span>
            </span>
          </>
        )

        return storedResultsAvailable ? (
          <article className="case-law-result" key={result.id}>
            <Link
              to="/cases/$caseId"
              params={{ caseId: result.id }}
              className="case-law-result__summary"
            >
              {summary}
            </Link>
          </article>
        ) : (
          <article className="case-law-result" key={result.id}>
            <a
              className="case-law-result__summary"
              href={result.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              {summary}
            </a>
          </article>
        )
      })}
    </section>
  )
}
