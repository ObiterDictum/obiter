import { Link } from '@tanstack/react-router'
import { caseResultLocation } from '../../case-navigation'
import type {
  LegalSearchBrowseContext,
  LegalSearchFetchResponse,
  LegalSearchResult,
} from './searchTypes'

interface SearchResultsProps {
  response: LegalSearchFetchResponse
  browse?: LegalSearchBrowseContext
  selectedIndex: number
  onSelectIndex: (index: number) => void
}

export function SearchResults({
  response,
  browse,
  selectedIndex,
  onSelectIndex,
}: SearchResultsProps) {
  const storedResultsAvailable = response.cached || response.indexedCount > 0
  const selected = response.hits[selectedIndex] ?? response.hits[0]

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
      <section
        className="min-h-0 overflow-y-auto border-b border-line lg:border-b-0 lg:border-r"
        aria-live="polite"
      >
        <p className="px-4 pb-1 pt-3 text-[11px] font-medium tracking-wide text-muted sm:px-5">
          {formatResultMeta(response, storedResultsAvailable, browse)}
        </p>
        <ul className="flex flex-col gap-0.5 px-2 pb-3 sm:px-3">
          {response.hits.map((result, index) => {
            const location = caseResultLocation(result)
            return (
              <li key={result.id}>
                <Link
                  {...location}
                  className="block rounded-md px-2.5 py-2 text-ink transition-colors hover:bg-raised data-[selected=true]:bg-raised"
                  data-selected={selectedIndex === index ? 'true' : undefined}
                  aria-current={selectedIndex === index ? 'true' : undefined}
                  onClick={(event) => {
                    event.preventDefault()
                    onSelectIndex(index)
                  }}
                >
                  <strong className="block text-sm font-medium leading-snug">
                    {result.title}
                  </strong>
                  <small className="mt-0.5 block text-[11px] text-muted">
                    {formatNeutralCitation(result.neutralCitation)} ·{' '}
                    {result.court} · {result.dateDecided}
                  </small>
                  <small className="mt-0.5 block text-[11px] text-subtle">
                    {formatMatchReason(result.matchReason)}
                    {result.retrievalPath
                      ? ` · ${formatRetrievalPath(result.retrievalPath)}`
                      : ''}
                  </small>
                </Link>
              </li>
            )
          })}
        </ul>
      </section>

      <JudgmentReader
        result={selected}
        storedResultsAvailable={storedResultsAvailable}
      />
    </div>
  )
}

function JudgmentReader({
  result,
  storedResultsAvailable,
}: {
  result: LegalSearchResult | undefined
  storedResultsAvailable: boolean
}) {
  if (!result) {
    return (
      <article className="flex min-h-[12rem] items-center justify-center p-6">
        <p className="text-sm text-muted">Select a result to read the source.</p>
      </article>
    )
  }

  const location = caseResultLocation(result)
  const paragraphs = result.paragraphs ?? []
  const snippets = result.snippets ?? []

  return (
    <article className="min-h-0 overflow-y-auto p-5 sm:p-6" aria-label={result.title}>
      <header className="mb-5 border-b border-line pb-4">
        <h2 className="text-lg font-semibold leading-snug tracking-tight text-ink">
          {result.title}
        </h2>
        <p className="mt-1.5 text-xs text-muted">
          {formatNeutralCitation(result.neutralCitation)} · {result.court} ·{' '}
          {result.dateDecided}
        </p>
        <div
          className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted"
          role="tablist"
          aria-label="Source views"
        >
          <span
            className="border-b border-ink/40 pb-0.5 font-medium text-ink"
            role="tab"
            aria-selected
          >
            Judgment
          </span>
          <span role="tab" aria-selected={false}>
            Cited by
          </span>
          <span role="tab" aria-selected={false}>
            Cites
          </span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Link
            {...location}
            className="text-xs font-medium text-brand transition-colors hover:text-brand-pressed"
          >
            Open full judgment
          </Link>
          <span className="text-[11px] text-subtle">
            {storedResultsAvailable ? 'Stored source' : 'Find Case Law'}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-4">
        {paragraphs.length > 0
          ? paragraphs.slice(0, 12).map((paragraph) => (
              <section key={paragraph.id} className="flex flex-col gap-1.5">
                <p className="text-sm leading-relaxed text-ink">
                  {paragraph.text}
                </p>
                <footer className="flex gap-2 text-[11px] text-muted">
                  <span className="font-semibold text-ink/80">
                    {paragraph.paragraphNumber}
                  </span>
                </footer>
              </section>
            ))
          : snippets.length > 0
            ? snippets.map((snippet) => (
                <section
                  key={`${result.id}-${snippet.paragraphNumber}-${snippet.text.slice(0, 24)}`}
                  className="flex flex-col gap-1.5"
                >
                  <p className="text-sm leading-relaxed text-ink">
                    {renderSnippetText(snippet.text, snippet.matchedTerms)}
                  </p>
                  <footer className="flex gap-2 text-[11px] text-muted">
                    <span className="font-semibold text-ink/80">
                      {snippet.paragraphNumber}
                    </span>
                  </footer>
                </section>
              ))
            : (
              <p className="text-sm leading-relaxed text-muted">
                Preview text is not available for this hit. Open the full
                judgment to read the source.
              </p>
            )}
      </div>
    </article>
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

function renderSnippetText(text: string, matchedTerms: string[]) {
  const terms = Array.from(new Set(matchedTerms.filter(Boolean)))
  if (terms.length === 0) return text

  const matcher = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi')

  return text.split(matcher).map((part, index) =>
    terms.some((term) => part.toLowerCase() === term.toLowerCase()) ? (
      <mark
        className="rounded-sm bg-brand/30 px-0.5 text-ink"
        key={`${part}-${index}`}
      >
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
