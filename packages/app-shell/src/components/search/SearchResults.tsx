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
        {response.hits.length} {response.hits.length === 1 ? 'result' : 'results'} from{' '}
        {response.cached || storedResultsAvailable ? 'stored legal sources' : 'Find Case Law'}
      </p>
      {response.hits.map((result) => {
        const summary = (
          <>
            <span>
              <strong>{result.title}</strong>
              <small>
                {formatNeutralCitation(result.neutralCitation)} - {result.court} - {result.dateDecided}
              </small>
            </span>
            <span className="case-law-result__actions">
              <span className="case-law-result__toggle">
                Open case
              </span>
              <span className="case-law-result__source">
                {storedResultsAvailable ? 'Stored source' : 'Find Case Law'}
              </span>
            </span>
          </>
        )

        return (
          <article className="case-law-result" key={result.id}>
            <Link
              to="/cases/$caseId"
              params={{ caseId: result.id }}
              className="case-law-result__summary"
            >
              {summary}
            </Link>
            {result.snippets && result.snippets.length > 0 ? (
              <div className="case-law-result__snippets" aria-label="Matching judgment snippets">
                {result.snippets.map((snippet) => (
                  <p className="case-law-result__snippet" key={`${result.id}-${snippet.paragraphNumber}`}>
                    <span className="case-law-result__snippet-label">[{snippet.paragraphNumber}]</span>
                    {snippet.text}
                  </p>
                ))}
              </div>
            ) : null}
          </article>
        )
      })}
    </section>
  )
}

function formatNeutralCitation(neutralCitation: string | null) {
  return neutralCitation ?? 'No neutral citation'
}
