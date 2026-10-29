import {
  dateDecidedTimestampField,
  legalSearchIndexSettings,
  searchSummaryAttributes,
  toDateDecidedTimestamp,
} from './index-settings'
import type {
  EngineRankingHit,
  LegalSearchFilters,
  LegalSearchHit,
  LegalSearchOptions,
  LegalSearchResult,
  SearchClient,
} from './index-types'
import {
  normalizeExactMatchValue,
  rankLegalSearchHitsByExactMatch,
  readEngineRankingScore,
} from './search-ranking'
import { extractLegalSearchSnippets } from './search-snippets'
import { wrapSearchError } from './search-errors'
import {
  LegalAuthoritySchema,
  LegalAuthoritySummarySchema,
} from '@obiter/legal-schema'

interface EngineSearchOptions {
  filter?: string[]
  sort?: string[]
  attributesToRetrieve?: string[]
  limit?: number
  matchingStrategy?: 'all' | 'frequency'
  rankingScoreThreshold?: number
  showRankingScore?: boolean
}

export async function search(
  client: SearchClient,
  indexName: string,
  query: string,
  filters: LegalSearchFilters = {},
  options: LegalSearchOptions = {},
): Promise<LegalSearchResult> {
  // Built before the try: a malformed filter is the caller's input error, and
  // wrapping it as a provider failure would hide which filter was wrong behind
  // a generic "Search failed."
  const filter = toMeiliFilters(filters)

  try {
    const searchOptions: EngineSearchOptions = {
      filter,
      sort: ['dateDecided:desc'],
      matchingStrategy:
        options.matchingStrategy ?? legalSearchIndexSettings.matchingStrategy,
      showRankingScore: true,
      attributesToRetrieve:
        options.includeParagraphs || options.includeSnippets
          ? [...searchSummaryAttributes, 'paragraphs']
          : searchSummaryAttributes,
    }
    if (typeof options.limit === 'number') searchOptions.limit = options.limit
    if (query && options.rankingScoreThreshold !== null) {
      searchOptions.rankingScoreThreshold =
        options.rankingScoreThreshold ??
        legalSearchIndexSettings.rankingScoreThreshold
    }

    const providerSearchStartedAt = performance.now()
    // A recognised citation searches as a phrase: the caller already knows
    // what it is looking for, so keyword neighbours are noise, not recall.
    const trimmedPhrase = options.exactPhrase?.trim()
    const engineQuery = trimmedPhrase
      ? toExactPhraseQuery(trimmedPhrase)
      : query
    const result = await client
      .index(indexName)
      .search(engineQuery, searchOptions)
    const providerSearchTimeMs = performance.now() - providerSearchStartedAt
    const clientProcessingStartedAt = performance.now()
    const hits: LegalSearchHit[] = result.hits.map((hit) => {
      const parsedHit =
        options.includeParagraphs || options.includeSnippets
          ? LegalAuthoritySchema.parse(hit)
          : LegalAuthoritySummarySchema.parse(hit)
      // SAFETY: Meilisearch hit is external JSON; _rankingScore is engine metadata outside LegalAuthority schema, read via named EngineRankingHit interface after schema parse
      const engineRankingScore = readEngineRankingScore(hit as EngineRankingHit)
      return engineRankingScore === undefined
        ? parsedHit
        : { ...parsedHit, engineRankingScore }
    })
    const rankedHits = rankLegalSearchHitsByExactMatch(
      hits.map((hit) => ({
        ...hit,
        snippets: options.includeSnippets
          ? extractLegalSearchSnippets(hit, query)
          : undefined,
      })),
      query,
    ).map((hit) => {
      if (options.includeParagraphs) return hit
      const { paragraphs: _paragraphs, ...summary } = hit
      return summary
    })

    return {
      hits: rankedHits,
      // Echo the caller's query, not the engine phrase form of it.
      query: trimmedPhrase ? query : (result.query ?? query),
      estimatedTotalHits: result.estimatedTotalHits ?? rankedHits.length,
      processingTimeMs: result.processingTimeMs ?? 0,
      diagnostics: {
        providerSearchTimeMs,
        clientProcessingTimeMs: performance.now() - clientProcessingStartedAt,
      },
    }
  } catch (error) {
    throw wrapSearchError('Search failed.', error)
  }
}

function toMeiliFilters(filters: LegalSearchFilters): string[] | undefined {
  const clauses: string[] = []

  if (filters.court) clauses.push(`court = ${quoteFilter(filters.court)}`)
  if (filters.jurisdiction)
    clauses.push(`jurisdiction = ${quoteFilter(filters.jurisdiction)}`)
  if (filters.sourceType)
    clauses.push(`sourceType = ${quoteFilter(filters.sourceType)}`)
  if (filters.dateFrom)
    clauses.push(
      `${dateDecidedTimestampField} >= ${toFilterTimestamp('dateFrom', filters.dateFrom)}`,
    )
  if (filters.dateTo)
    clauses.push(
      `${dateDecidedTimestampField} <= ${toFilterTimestamp('dateTo', filters.dateTo)}`,
    )

  return clauses.length > 0 ? clauses : undefined
}

/**
 * A malformed bound is rejected rather than dropped. Dropping it would widen the
 * result set past what the caller asked for and return dates outside the
 * requested range as though they belonged.
 */
function toFilterTimestamp(
  field: 'dateFrom' | 'dateTo',
  value: string,
): number {
  const timestamp = toDateDecidedTimestamp(value)

  if (timestamp === null) {
    throw new Error(`Search filter ${field} must be an ISO date (YYYY-MM-DD).`)
  }

  return timestamp
}

function quoteFilter(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

export function toExactPhraseQuery(phrase: string) {
  const normalized = normalizeExactMatchValue(phrase)
  const escaped = normalized.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `"${escaped}"`
}
