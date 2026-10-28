import { getLegislationScheduleGuidanceFeedback } from './components/search/legislationGuidance'
import type {
  LegalSearchOutcome,
  LegalSearchRequestFilters,
  LegalSearchState,
  LegislationScheduleGuidance,
} from './components/search/searchTypes'

export const LEGAL_SEARCH_DEBOUNCE_MS = 300
// Bounded recheck for hydration_queued: the background path has not
// consulted live yet, so a queue position is honest there but cannot
// resolve itself. Five rechecks at 2s (~10s total) covers a normal
// hydration landing without letting the spinner run forever (the reported
// case polled byte-identical for 80s+). When the bound is reached the UI
// says so plainly instead of spinning on.
export const LEGAL_SEARCH_HYDRATION_POLL_MS = 2000
export const LEGAL_SEARCH_HYDRATION_MAX_POLLS = 5
export function getLegalSearchStateLabel(state: LegalSearchState) {
  switch (state.status) {
    case 'idle':
      return 'idle'
    case 'loading':
      return 'loading'
    case 'results':
      return 'results'
    case 'empty':
      return 'empty'
    case 'error':
      return 'error'
  }
}

export type LegalSearchFetchRequest = {
  query: string
  court?: string
  dateFrom?: string
  dateTo?: string
  sourceType?: string
  sourceFamily?: string
  legalDomain?: string
  provider?: string
  topic?: string
  asAtDate?: string
  legislationVersion?: string
}

export function createLegalSearchFetchRequest(
  query: string,
  filters: LegalSearchRequestFilters,
) {
  const trimmedQuery = query.trim()
  const request: LegalSearchFetchRequest = {
    query: trimmedQuery,
  }
  const court = filters.court.trim()
  const dateFrom = filters.dateFrom.trim()
  const dateTo = filters.dateTo.trim()
  const optionalFilters = {
    sourceType: filters.sourceType,
    sourceFamily: filters.sourceFamily,
    legalDomain: filters.legalDomain,
    provider: filters.provider,
    topic: filters.topic,
    asAtDate: filters.asAtDate,
    legislationVersion: filters.legislationVersion,
  }

  if (court) request.court = court
  if (dateFrom) request.dateFrom = dateFrom
  if (dateTo) request.dateTo = dateTo
  for (const [key, value] of Object.entries(optionalFilters)) {
    const trimmedValue = value?.trim()
    if (trimmedValue) {
      // SAFETY: key comes from Object.entries of optionalFilters itself, so it is always one of its keys, and request declares the same optional fields.
      request[key as keyof typeof optionalFilters] = trimmedValue
    }
  }

  return request
}

export function countActiveLegalSearchFilters(
  filters: LegalSearchRequestFilters,
) {
  return [
    filters.court,
    filters.dateFrom,
    filters.dateTo,
    filters.sourceType,
    filters.sourceFamily,
    filters.legalDomain,
    filters.provider,
    filters.topic,
    filters.asAtDate,
    filters.legislationVersion,
  ].filter((value) => value?.trim()).length
}

export function getLegalSearchStateAfterInputChange(): LegalSearchState {
  return { status: 'idle' }
}

export function getLegalSearchEmptyFeedback(input: {
  query: string
  outcome?: LegalSearchOutcome
  hydrationQueued?: boolean
  browse?: { courtLabel: string }
  /** 1-based count of queued polls so far, for the progress line. */
  hydrationAttempt?: number
  /** True once the bounded recheck gives up waiting. */
  hydrationExpired?: boolean
  /** Response diagnostics.legislationNote: the legislation half recognised a
   * citation but served nothing. Names what was asked for. */
  legislationNote?: string
  /** Response diagnostics.legislationNotHeld: an authoritative not-held
   * verdict, not an outage. */
  legislationNotHeld?: boolean
  /** Response diagnostics.legislationTitleUnresolved: a whole-title request no
   * exact title key matched. */
  legislationTitleUnresolved?: boolean
  /** Response diagnostics.legislationAmbiguous: more than one stored Act
   * satisfies the query. */
  legislationAmbiguous?: boolean
  /** Response diagnostics.legislationScheduleGuidance: a schedule citation
   * that names a paragraph but no schedule. The structured example and Act
   * context drive a corrective with a resubmission the parser accepts. */
  legislationScheduleGuidance?: LegislationScheduleGuidance
}) {
  const outcome =
    input.outcome ?? (input.hydrationQueued ? 'hydration_queued' : 'no_match')

  // A held Act whose schedule citation names no schedule. A corrective, not a
  // not-held verdict: it must show the parser-compatible example with its Act
  // context rather than fall through to the generic judgment copy.
  if (input.legislationScheduleGuidance) {
    return getLegislationScheduleGuidanceFeedback(
      input.legislationScheduleGuidance,
    )
  }

  // The legislation half's honest negatives. Each rides its own flag, so a
  // terminal branch that answers no_match or hydration_queued still surfaces
  // the verdict, and the generic judgment copy below never stands in for it.
  // The not-held copy is reserved for an authoritative verdict (a chapter or
  // provision the store proves absent), never a failed title lookup.
  if (input.legislationNotHeld && input.legislationNote) {
    return {
      eyebrow: 'Legislation not held',
      title: 'No stored legislation matches this search',
      body: `${input.legislationNote} Nothing that merely shares words with the title is shown in its place.`,
    }
  }

  // A whole-title request the directory could not resolve. Say only what is
  // known: no exact title matched. Never claim the Act itself is absent, and
  // suppress the unrelated keyword provisions the exact path would otherwise
  // fall through to.
  if (input.legislationTitleUnresolved && input.legislationNote) {
    return {
      eyebrow: 'Legislation title not matched',
      title: 'No exact legislation title match',
      body: `${input.legislationNote} Try the chapter citation (for example "2010 c. 15") or the Act's exact short title.`,
    }
  }

  if (input.legislationAmbiguous && input.legislationNote) {
    return {
      eyebrow: 'Legislation ambiguous',
      title: 'More than one stored Act matches',
      body: `${input.legislationNote} Choose the Act you meant by its chapter citation.`,
    }
  }

  // Honest empty for a well-formed citation no source holds. Names the
  // citation so the failure reads as not-held rather than not-searched. A
  // stored-only search must not claim a provider was consulted, and the
  // corpus-only API never consults one.
  if (outcome === 'recognised_not_held') {
    return {
      eyebrow: 'Citation not held',
      title: 'No judgment held for this citation',
      body: `No stored legal source holds "${input.query}" as a judgment. Providers were not consulted for this search. Check the citation or search party names instead.`,
    }
  }

  if (outcome === 'hydration_queued') {
    if (input.hydrationExpired) {
      return {
        eyebrow: 'Search queued',
        title: 'Still no match after rechecks',
        body: `Stored sources did not have "${input.query}" and rechecks of public legal sources found nothing new. Retry the search or refine the query.`,
      }
    }
    const attempt = Math.max(1, input.hydrationAttempt ?? 1)
    return {
      eyebrow: 'Search queued',
      title: 'Checking legal sources',
      body: `Stored sources did not yet have "${input.query}". Rechecking public legal sources automatically (check ${attempt} of ${LEGAL_SEARCH_HYDRATION_MAX_POLLS + 1}); results will appear without retyping.`,
    }
  }

  if (outcome === 'stored_browse_empty' || input.browse) {
    return {
      eyebrow: 'No stored cases',
      title: 'No recent cases found',
      body: `No recent stored cases found for ${input.browse?.courtLabel ?? 'the selected court'}.`,
    }
  }

  if (outcome === 'unsupported_source_type') {
    return {
      eyebrow: 'Unsupported search',
      title: 'This source type is not searchable yet',
      body: `Search currently covers judgments. Refine to a judgment search for "${input.query}".`,
    }
  }

  return {
    eyebrow: 'No indexed match',
    title: 'No sources found',
    body: `Stored legal sources did not match "${input.query}" with the selected filters. Providers were not consulted for this search.`,
  }
}

export function shouldRunLegalSearch(query: string) {
  return query.trim().length > 0
}

export function shouldRunLegalSearchRequest(
  query: string,
  filters: LegalSearchRequestFilters,
) {
  return shouldRunLegalSearch(query) || Boolean(filters.court.trim())
}
