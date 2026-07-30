import { Link } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { caseResultLocation } from '../../case-navigation'
import type {
  LegalSearchBrowseContext,
  LegalSearchFetchResponse,
} from './searchTypes'

interface SearchResultsProps {
  response: LegalSearchFetchResponse
  browse?: LegalSearchBrowseContext
  selectedIndex: number
  onSelectIndex: (index: number) => void
}

/**
 * Full-width result list under the search field. Opening a hit goes to the
 * judgment route — no split reader pane.
 */
export function SearchResults({
  response,
  browse,
  selectedIndex,
  onSelectIndex,
}: SearchResultsProps) {
  const storedResultsAvailable = response.cached || response.indexedCount > 0

  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto"
      aria-live="polite"
      aria-label="Search results"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-6">
        <p className="pb-3 text-[11px] font-medium tracking-wide text-muted">
          {formatResultMeta(response, storedResultsAvailable, browse)}
        </p>
        <ul className="flex flex-col gap-1">
          {response.hits.map((result, index) => {
            const location = caseResultLocation(result)
            const selected = selectedIndex === index
            return (
              <li key={result.id}>
                <Link
                  {...location}
                  className={
                    selected
                      ? 'group flex items-start justify-between gap-4 rounded-md bg-raised px-3 py-3 text-ink transition-colors'
                      : 'group flex items-start justify-between gap-4 rounded-md px-3 py-3 text-ink transition-colors hover:bg-raised'
                  }
                  data-selected={selected ? 'true' : undefined}
                  aria-current={selected ? 'true' : undefined}
                  onFocus={() => onSelectIndex(index)}
                  onMouseEnter={() => onSelectIndex(index)}
                >
                  <span className="min-w-0 flex-1">
                    <strong className="block text-sm font-medium leading-snug">
                      {result.title}
                    </strong>
                    <small className="mt-1 block text-[12px] text-muted">
                      {formatNeutralCitation(result.neutralCitation)} ·{' '}
                      {result.court} · {result.dateDecided}
                    </small>
                    <small className="mt-1 block text-[11px] text-subtle">
                      {formatMatchReason(result.matchReason)}
                      {result.retrievalPath
                        ? ` · ${formatRetrievalPath(result.retrievalPath)}`
                        : ''}
                    </small>
                  </span>
                  <ArrowRight
                    aria-hidden
                    size={16}
                    className="mt-0.5 shrink-0 text-subtle transition-colors group-hover:text-ink"
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
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
    response.cached || storedResultsAvailable
      ? 'stored legal sources'
      : 'Find Case Law'
  }`
}
