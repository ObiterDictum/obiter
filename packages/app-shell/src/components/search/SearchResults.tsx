import { ArrowRight } from '@phosphor-icons/react'
import type { LegalSearchBrowseContext, LegalSearchFetchResponse } from './searchTypes'

interface SearchResultsProps {
  response: LegalSearchFetchResponse
  browse?: LegalSearchBrowseContext
  selectedIndex: number
}

export function SearchResults({ response, browse, selectedIndex }: SearchResultsProps) {
  const storedResultsAvailable = response.cached || response.indexedCount > 0

  return (
    <section className="flex flex-col gap-2.5" aria-live="polite">
      <p className="text-sm text-muted">
        {formatResultMeta(response, storedResultsAvailable, browse)}
      </p>
      {response.hits.map((result, index) => {
        const summary = (
          <>
            <span className="min-w-0">
              <strong className="block text-base font-semibold leading-snug text-ink">{result.title}</strong>
              <small className="mt-1.5 block text-xs text-muted">
                {formatNeutralCitation(result.neutralCitation)} · {result.court} · {result.dateDecided}
              </small>
              <small className="mt-0.5 block text-xs text-subtle">
                {formatMatchReason(result.matchReason)}
                {result.retrievalPath ? ` · ${formatRetrievalPath(result.retrievalPath)}` : ''}
              </small>
            </span>
            <span className="flex shrink-0 items-center gap-2 self-center">
              <span className="hidden rounded-pill border border-line bg-canvas px-2 py-1 text-xs font-semibold text-muted sm:inline">
                {storedResultsAvailable ? 'Stored' : 'Find Case Law'}
              </span>
              <ArrowRight aria-hidden="true" size={15} weight="bold" className="text-subtle" />
            </span>
          </>
        )

        return (
          <article
            className="overflow-hidden rounded-lg border border-line bg-surface transition-colors data-[selected=true]:border-brand data-[selected=true]:shadow-sm"
            data-selected={selectedIndex === index ? 'true' : undefined}
            key={result.id}
          >
            <a
              href={result.canonicalUrl ?? `/cases/${encodeURIComponent(result.id)}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 p-4 text-ink transition-colors hover:bg-canvas"
              aria-current={selectedIndex === index ? 'true' : undefined}
            >
              {summary}
            </a>
            {result.snippets && result.snippets.length > 0 ? (
              <div className="flex flex-col gap-2 border-t border-line bg-canvas/40 px-4 pb-4 pt-3" aria-label="Matching judgment snippets">
                {result.snippets.map((snippet) => (
                  <p className="text-sm leading-relaxed text-muted" key={`${result.id}-${snippet.paragraphNumber}`}>
                    <span className="mr-2 font-semibold text-subtle">[{snippet.paragraphNumber}]</span>
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
    case 'title_match':
      return 'Title match'
    case 'body_text_match':
      return 'Body text match'
    case 'keyword_match':
      return 'Keyword match'
    default:
      return 'Match reason pending'
  }
}

function formatRetrievalPath(retrievalPath: string) {
  switch (retrievalPath) {
    case 'stored_exact_lookup':
      return 'exact lookup'
    case 'stored_index':
      return 'stored index'
    case 'stored_source':
      return 'stored source'
    case 'live_provider':
      return 'Find Case Law'
    default:
      return retrievalPath
  }
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
      <mark className="rounded-sm bg-brand/30 px-0.5 text-ink" key={`${part}-${index}`}>{part}</mark>
    ) : (
      part
    ),
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
