import { getLegislationScheduleGuidanceFeedback } from './components/search/legislationGuidance'
import type {
  LegalSearchOutcome,
  LegalSearchRequestFilters,
  LegalSearchState,
  LegislationScheduleGuidance,
} from './components/search/searchTypes'

export const LEGAL_SEARCH_DEBOUNCE_MS = 300
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
  hydrationAttempt?: number
  hydrationExpired?: boolean
  legislationNote?: string
  legislationNotHeld?: boolean
  legislationTitleUnresolved?: boolean
  legislationAmbiguous?: boolean
  legislationScheduleGuidance?: LegislationScheduleGuidance
  filtersActive?: boolean
}) {
  const outcome =
    input.outcome ?? (input.hydrationQueued ? 'hydration_queued' : 'no_match')

  if (input.legislationScheduleGuidance) {
    return getLegislationScheduleGuidanceFeedback(
      input.legislationScheduleGuidance,
    )
  }

  if (input.legislationNotHeld && input.legislationNote) {
    return {
      eyebrow: 'Legislation not held',
      title: 'No stored legislation matches this search',
      body: `${input.legislationNote} Nothing that merely shares words with the title is shown in its place.`,
    }
  }

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

  if (outcome === 'recognised_not_held') {
    return {
      eyebrow: 'Citation not held',
      title: 'No judgment held for this citation',
      body: `No stored legal source holds "${input.query}" as a judgment. Check the citation, or search by party name instead.`,
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
    body: input.filtersActive
      ? `No stored source matches "${input.query}" with the selected filters. Clear them to search the whole corpus, or try the public sources below.`
      : `No stored source matches "${input.query}". Try fewer or different words, or search the public sources below.`,
  }
}

export function getLegalSearchElsewhereLinks(query: string) {
  const encoded = encodeURIComponent(query.trim())
  return [
    {
      label: 'Search legislation.gov.uk',
      href: `https://www.legislation.gov.uk/search?title=${encoded}`,
    },
    {
      label: 'Search The National Archives',
      href: `https://caselaw.nationalarchives.gov.uk/search?query=${encoded}`,
    },
  ]
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
