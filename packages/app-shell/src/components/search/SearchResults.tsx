import { Link } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { caseResultLocation } from '../../case-navigation'
import type {
  LegalSearchBrowseContext,
  LegalSearchFetchGroup,
  LegalSearchFetchResponse,
  LegislationSearchResultHit,
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
  return (
    <section
      className="min-h-0 flex-1 overflow-y-auto"
      aria-live="polite"
      aria-label="Search results"
    >
      <div className="mx-auto w-full max-w-3xl px-5 py-4 sm:px-6">
        <p className="pb-3 text-[11px] font-medium tracking-wide text-muted">
          {formatResultMeta(response, browse)}
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
                      {formatCitationMatch(result.citationMatch)}
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
        {response.groups?.map((group) => (
          <LegislationGroupSection key={group.key} group={group} />
        ))}
      </div>
    </section>
  )
}

/**
 * Federated legislation group: provision text when current, the amended
 * notice with the official link when recorded amendments are unapplied.
 * Amended provisions never render text here because the API never sends it.
 */
function LegislationGroupSection({ group }: { group: LegalSearchFetchGroup }) {
  if (group.hits.length === 0) return null
  return (
    <div className="mt-6">
      <h2 className="pb-2 text-[11px] font-medium tracking-wide text-muted">
        {group.label}
      </h2>
      <ul className="flex flex-col gap-1">
        {group.hits.map((hit) => (
          <li
            key={hit.id}
            className="rounded-md px-3 py-3 text-ink transition-colors hover:bg-raised"
          >
            <LegislationHit hit={hit} />
          </li>
        ))}
      </ul>
    </div>
  )
}

function LegislationHit({ hit }: { hit: LegislationSearchResultHit }) {
  // Act-level hits carry a notice and no text: render the notice so the
  // "Matched X. Add a section number" guidance is visible. Amended hits
  // never render text even if a caller passes it (API never sends it).
  if (hit.legislationStatus === 'amended_not_held') {
    return (
      <span className="block min-w-0 flex-1">
        <strong className="block text-sm font-medium leading-snug">
          {hit.provisionLabel} · {hit.title}
        </strong>
        <span className="mt-1 block text-[12px] text-muted">
          {hit.notice}{' '}
          <a
            href={hit.officialUrl}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Read the official revised provision
          </a>
        </span>
        <small className="mt-1 block text-[11px] text-subtle">
          legislation.gov.uk
          {hit.extent ? ` · ${hit.extent}` : ''}
        </small>
      </span>
    )
  }
  return (
    <span className="block min-w-0 flex-1">
      <strong className="block text-sm font-medium leading-snug">
        {hit.provisionLabel} · {hit.title}
      </strong>
      {hit.notice ? (
        <span className="mt-1 block text-[12px] text-muted">{hit.notice}</span>
      ) : null}
      {(hit.snippets?.[0]?.text ?? hit.text) ? (
        <span className="mt-1 block text-[12px] text-muted">
          {hit.snippets?.[0]?.text ?? hit.text}
        </span>
      ) : null}
      <small className="mt-1 block text-[11px] text-subtle">
        legislation.gov.uk
        {hit.extent ? ` · ${hit.extent}` : ''}
      </small>
    </span>
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
    case 'partial_title_match':
      return 'Partial title match'
    case 'body_text_match':
      return 'Body text match'
    case 'keyword_match':
      return 'Keyword match'
    default:
      return 'Match reason pending'
  }
}

/**
 * Citation relation to the queried citation. Exact needs no extra label:
 * the match reason already says so. Citing is the honest distinction this
 * change exists for; anything else stays quiet.
 */
function formatCitationMatch(citationMatch: string | undefined) {
  switch (citationMatch) {
    case 'citing':
      return ' · Cites the queried citation'
    default:
      return ''
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
  browse?: LegalSearchBrowseContext,
) {
  if (browse) {
    const caseLabel = response.hits.length === 1 ? 'case' : 'cases'
    return `${response.hits.length} recent ${caseLabel} for ${browse.courtLabel} from stored legal sources`
  }

  // A recognised citation no source holds still serves the cases that cite
  // it. The count says what they are so citing cases never read as the
  // judgment itself. The citing claim needs labelled hits behind it: live
  // neighbours without body or title proof stay neutral so the header never
  // overrules what the cards can show.
  if (response.citation?.status === 'not_held' && response.hits.length > 0) {
    const resultLabel = response.hits.length === 1 ? 'result' : 'results'
    if (response.hits.every((hit) => hit.citationMatch === 'citing')) {
      return `Citation not held · ${response.hits.length} citing ${resultLabel} from Find Case Law`
    }
    return `Citation not held · ${response.hits.length} ${resultLabel} from Find Case Law`
  }

  const resultLabel = response.hits.length === 1 ? 'result' : 'results'
  // Source attribution reads the served retrieval paths, never the cache
  // flag: a non-cached set can still be stored hits, and a cached set is
  // always stored. Unknown (pathless) hits stay neutral so the line never
  // claims a provider was consulted when the response does not say so.
  const paths = new Set(
    response.hits.map((hit) => hit.retrievalPath).filter(Boolean),
  )
  const hasLive = paths.has('live_provider')
  const hasStored = [...paths].some((path) => path?.startsWith('stored'))
  if (hasLive && hasStored) {
    return `${response.hits.length} ${resultLabel} from stored legal sources and Find Case Law`
  }
  if (hasLive) {
    return `${response.hits.length} ${resultLabel} from Find Case Law`
  }
  if (hasStored) {
    return `${response.hits.length} ${resultLabel} from stored legal sources`
  }
  return `${response.hits.length} ${resultLabel} from ${
    response.cached ? 'stored legal sources' : 'legal sources'
  }`
}
