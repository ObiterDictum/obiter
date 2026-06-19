import { Link } from '@tanstack/react-router'
import type { LegalSearchBrowseContext, LegalSearchFetchResponse } from './searchTypes'

interface SearchResultsProps {
  response: LegalSearchFetchResponse
  browse?: LegalSearchBrowseContext
  selectedIndex: number
}

export function SearchResults({ response, browse, selectedIndex }: SearchResultsProps) {
  const storedResultsAvailable = response.cached || response.indexedCount > 0

  return (
    <section className="legal-search__results" aria-live="polite">
      <p className="legal-search__meta">
        {formatResultMeta(response, storedResultsAvailable, browse)}
      </p>
      {response.hits.map((result, index) => {
        const summary = (
          <>
            <span>
              <strong>{result.title}</strong>
              <small>
                {formatNeutralCitation(result.neutralCitation)} - {result.court} - {result.dateDecided}
              </small>
            </span>
            <span className="case-law-result__actions">
              <span className="case-law-result__toggle">Open case</span>
              <span className="case-law-result__source">
                {storedResultsAvailable ? 'Stored source' : 'Find Case Law'}
              </span>
            </span>
          </>
        )

        return (
          <article
            className="case-law-result"
            data-selected={selectedIndex === index ? 'true' : undefined}
            key={result.id}
          >
            <Link
              to="/cases/$caseId"
              params={{ caseId: result.id }}
              className="case-law-result__summary"
              aria-current={selectedIndex === index ? 'true' : undefined}
            >
              {summary}
            </Link>
            {result.snippets && result.snippets.length > 0 ? (
              <div className="case-law-result__snippets" aria-label="Matching judgment snippets">
                {result.snippets.map((snippet) => (
                  <p className="case-law-result__snippet" key={`${result.id}-${snippet.paragraphNumber}`}>
                    <span className="case-law-result__snippet-label">[{snippet.paragraphNumber}]</span>
                    {renderSnippetText(snippet.text, snippet.matchedTerms)}
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

function formatResultMeta(
  response: LegalSearchFetchResponse,
  storedResultsAvailable: boolean,
  browse?: LegalSearchBrowseContext,
) {
  if (browse) {
    const caseLabel = response.hits.length === 1 ? 'case' : 'cases'
    return `${response.hits.length} recent ${caseLabel} for ${browse.courtLabel} from stored legal sources`
  }

  const resultLabel = response.hits.length === 1 ? 'result' : 'results'
  return `${response.hits.length} ${resultLabel} from ${
    response.cached || storedResultsAvailable ? 'stored legal sources' : 'Find Case Law'
  }`
}

function renderSnippetText(text: string, matchedTerms: string[]) {
  const terms = Array.from(new Set(matchedTerms.filter(Boolean)))
  if (terms.length === 0) return text

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')

  return text.split(matcher).map((part, index) =>
    terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark key={`${part}-${index}`}>{part}</mark>
    ) : (
      part
    ),
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
