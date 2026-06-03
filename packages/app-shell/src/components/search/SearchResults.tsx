import { Link } from '@tanstack/react-router'
import type { LegalSearchBrowseContext, LegalSearchFetchResponse } from './searchTypes'

interface SearchResultsProps {
  response: LegalSearchFetchResponse
  browse?: LegalSearchBrowseContext
}

export function SearchResults({ response, browse }: SearchResultsProps) {
  const storedResultsAvailable = response.cached || response.indexedCount > 0

  return (
    <section className="legal-search__results" aria-live="polite">
      <p className="legal-search__meta">
        {formatResultMeta(response, storedResultsAvailable, browse)}
      </p>
      {response.hits.map((result) => {
        const summary = (
          <>
            <span>
              <strong>{result.title}</strong>
              <small>
                {formatNeutralCitation(result.neutralCitation)} - {result.court} - {result.dateDecided}
              </small>
              <small>
                {formatMatchReason(result.matchReason)} - {formatEvidenceCount(result.evidenceIds)}
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

function formatMatchReason(matchReason: string | undefined) {
  switch (matchReason) {
    case 'exact_document_id':
      return 'Exact document id'
    case 'exact_neutral_citation':
      return 'Exact citation'
    case 'exact_title':
      return 'Exact title'
    case 'title_contains_query':
      return 'Title match'
    case 'title_terms_match':
      return 'Title terms match'
    case 'paragraph_phrase_match':
      return 'Paragraph phrase match'
    case 'paragraph_terms_match':
      return 'Paragraph terms match'
    case 'paragraph_term_match':
      return 'Paragraph term match'
    default:
      return 'Keyword match'
  }
}

function formatEvidenceCount(evidenceIds: string[] | undefined) {
  const count = evidenceIds?.length ?? 0
  if (count === 0) return 'No snippet evidence'
  return `${count} evidence ${count === 1 ? 'ref' : 'refs'}`
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
