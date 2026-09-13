import { Link } from '@tanstack/react-router'
import { ArrowRight } from '@phosphor-icons/react'
import { caseResultLocation } from '../../case-navigation'
import { LegislationHit } from './LegislationHit'
import { legislationHits } from './searchResultRows'
import {
  getLegislationScheduleGuidanceFeedback,
  getLegislationScheduleResubmitQuery,
} from './legislationGuidance'
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
  onResubmit?: (query: string) => void
}

/**
 * Full-width result list under the search field. Opening a hit goes to the
 * judgment or provision route — no split reader pane.
 */
export function SearchResults({
  response,
  browse,
  selectedIndex,
  onSelectIndex,
  onResubmit,
}: SearchResultsProps) {
  const legislationLead = response.primaryGroup === 'legislation'
  const legislation = legislationHits(response)
  const showJudgments = response.hits.length > 0
  const showLegislation = legislation.length > 0
  const legislationNote = response.diagnostics?.legislationNote
  const legislationScheduleGuidance =
    response.diagnostics?.legislationScheduleGuidance
  const scheduleFeedback = legislationScheduleGuidance
    ? getLegislationScheduleGuidanceFeedback(legislationScheduleGuidance)
    : null
  const scheduleResubmitQuery = legislationScheduleGuidance
    ? getLegislationScheduleResubmitQuery(legislationScheduleGuidance)
    : null
  // Every legislation verdict the API marks explicitly: an authoritative
  // not-held, a whole-title request no exact key matched, a title two stored
  // Acts satisfy, or a schedule citation that names no schedule. An outage
  // note carries none of these flags, so the page cannot mistake "the store
  // did not answer" for a verdict.
  const legislationVerdict =
    Boolean(legislationScheduleGuidance) ||
    ((response.diagnostics?.legislationNotHeld === true ||
      response.diagnostics?.legislationTitleUnresolved === true ||
      response.diagnostics?.legislationAmbiguous === true) &&
      Boolean(legislationNote))
  const legislationOffset = legislationLead ? 0 : response.hits.length
  const judgmentOffset = legislationLead ? legislation.length : 0

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
        {legislationVerdict && !showLegislation ? (
          // The legislation half reached a verdict but served no group. Say so
          // by name, above any judgment results, so an empty legislation group
          // never reads as "we found nothing about this".
          <div
            role="status"
            className="mb-3 rounded-md border border-warning/30 bg-raised px-3 py-2 text-sm text-muted"
          >
            <p>{scheduleFeedback ? scheduleFeedback.body : legislationNote}</p>
            {scheduleResubmitQuery && onResubmit ? (
              <button
                className="mt-1 font-medium text-brand hover:underline"
                type="button"
                onClick={() => onResubmit(scheduleResubmitQuery)}
              >
                Use this citation
              </button>
            ) : null}
          </div>
        ) : null}
        {legislationLead ? (
          <>
            {showLegislation ? (
              <LegislationGroup
                hits={legislation}
                selectedIndex={selectedIndex}
                offset={legislationOffset}
                onSelectIndex={onSelectIndex}
              />
            ) : null}
            {showJudgments ? (
              <JudgmentGroup
                hits={response.hits}
                selectedIndex={selectedIndex}
                offset={judgmentOffset}
                onSelectIndex={onSelectIndex}
              />
            ) : null}
          </>
        ) : (
          <>
            {showJudgments ? (
              <JudgmentGroup
                hits={response.hits}
                selectedIndex={selectedIndex}
                offset={judgmentOffset}
                onSelectIndex={onSelectIndex}
              />
            ) : null}
            {showLegislation ? (
              <LegislationGroup
                hits={legislation}
                selectedIndex={selectedIndex}
                offset={legislationOffset}
                onSelectIndex={onSelectIndex}
              />
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

function JudgmentGroup({
  hits,
  selectedIndex,
  offset,
  onSelectIndex,
}: {
  hits: LegalSearchResult[]
  selectedIndex: number
  offset: number
  onSelectIndex: (index: number) => void
}) {
  return (
    <div className={offset > 0 ? 'mt-6' : undefined}>
      <h2 className="pb-2 text-[11px] font-medium tracking-wide text-muted">
        Case law
      </h2>
      <ul className="flex flex-col gap-1">
        {hits.map((result, index) => {
          const location = caseResultLocation(result)
          const selected = selectedIndex === offset + index
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
                onFocus={() => onSelectIndex(offset + index)}
                onMouseEnter={() => onSelectIndex(offset + index)}
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
    </div>
  )
}

function LegislationGroup({
  hits,
  selectedIndex,
  offset,
  onSelectIndex,
}: {
  hits: ReturnType<typeof legislationHits>
  selectedIndex: number
  offset: number
  onSelectIndex: (index: number) => void
}) {
  return (
    <div className={offset > 0 ? 'mt-6' : undefined}>
      <h2 className="pb-2 text-[11px] font-medium tracking-wide text-muted">
        Legislation
      </h2>
      <ul className="flex flex-col gap-1">
        {hits.map((hit, index) => (
          <li key={hit.id}>
            <LegislationHit
              hit={hit}
              selected={selectedIndex === offset + index}
              onSelect={() => onSelectIndex(offset + index)}
            />
          </li>
        ))}
      </ul>
    </div>
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

  if (
    response.citation?.status === 'not_held' &&
    response.hits.length > 0 &&
    // A legislation not-held is reported by the legislation notice, not as a
    // judgment citation: the query asked for an Act, not a case. An outage
    // note is not a not-held verdict either.
    response.diagnostics?.legislationNotHeld !== true
  ) {
    const resultLabel = response.hits.length === 1 ? 'result' : 'results'
    if (response.hits.every((hit) => hit.citationMatch === 'citing')) {
      return `Citation not held · ${response.hits.length} citing ${resultLabel} from Find Case Law`
    }
    return `Citation not held · ${response.hits.length} ${resultLabel} from Find Case Law`
  }

  const resultLabel = response.hits.length === 1 ? 'result' : 'results'
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
