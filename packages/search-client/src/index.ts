import { MeiliSearch } from 'meilisearch'
import {
  LegalAuthoritySchema,
  legalAuthoritiesSchema,
  LegalAuthoritySummarySchema,
  type LegalAuthority,
  type LegalAuthoritySummary,
  type LegalSourceType,
} from '@obiter/legal-schema'

interface EngineRankingHit {
  _rankingScore?: number
}

export type LegalSearchDocument = LegalAuthority
export interface LegalSearchSnippet {
  evidenceId: string
  paragraphNumber: number
  text: string
  matchedTerms: string[]
  matchReason: LegalSearchMatchReason
}
export type LegalSearchMatchReason =
  | 'exact_document_id'
  | 'exact_neutral_citation'
  | 'title_match'
  | 'body_text_match'
  | 'keyword_match'
export type LegalSearchHit = LegalAuthoritySummary & {
  paragraphs?: LegalAuthority['paragraphs']
  snippets?: LegalSearchSnippet[]
  engineRankingScore?: number
}
export type LegalSearchFilters = Partial<{
  court: string
  jurisdiction: string
  sourceType: LegalSourceType
  dateFrom: string
  dateTo: string
}>

export interface SearchIndexOptions {
  primaryKey?: 'id'
  /**
   * Continue when the server does not support one of the index settings, and
   * report which. Off by default: a Meilisearch that cannot apply a setting is
   * not running the configuration this package defines, and a caller that has
   * not said it can live with that should be told rather than served silently.
   *
   * The one real case is `prefixSearch`, which Meilisearch added in 1.12.
   * A 1.8 server has no `settings/prefix-search` route and answers 404, so
   * prefix search stays on and short queries match on prefixes. That materially
   * changes short-word precision, which is why this is opt-in and reported
   * rather than assumed harmless.
   */
  allowUnsupportedSettings?: boolean
}

export interface SearchIndexResult {
  taskUid?: number
  /**
   * Settings the server could not apply, empty when everything applied. A run
   * that measures anything must put this in its report: a number measured under
   * a configuration the report does not name cannot be compared with one that
   * was.
   */
  unsupportedSettings: string[]
}

export interface SearchIndexDocumentsResult {
  indexedCount: number
  failedCount: number
  errors: Array<{ recordId: string | null; message: string }>
}

// Optional timings for diagnostics, not product behaviour.
export interface LegalSearchDiagnostics {
  providerSearchTimeMs: number
  clientProcessingTimeMs: number
}

export interface LegalSearchResult {
  hits: LegalSearchHit[]
  query: string
  estimatedTotalHits: number
  processingTimeMs: number
  diagnostics?: LegalSearchDiagnostics
}

export interface LegalSearchOptions {
  // With both of these false the request omits paragraphs, so ranking has no
  // body text to read and the body match tiers cannot fire.
  includeParagraphs?: boolean
  includeSnippets?: boolean
  limit?: number
  // Set null to disable the relevance floor when recall matters more than precision.
  rankingScoreThreshold?: number | null
  matchingStrategy?: 'all' | 'frequency'
}

interface SearchIndexingTask {
  uid?: number
  taskUid?: number
  status?: string
  details?: {
    receivedDocuments?: number
    indexedDocuments?: number
  }
  error?: {
    code?: string
    type?: string
  } | null
}

class SearchTaskError extends Error {
  constructor(task: SearchIndexingTask) {
    const taskId = task.uid ?? task.taskUid
    const taskLabel = typeof taskId === 'number' ? ` ${taskId}` : ''
    const errorCode = task.error?.code ?? task.error?.type
    const errorLabel = errorCode ? ` (${errorCode})` : ''

    super(
      `Meilisearch task${taskLabel} ${task.status ?? 'failed'}${errorLabel}.`,
    )
    this.name = 'SearchTaskError'
  }
}

type SearchEnqueuedTaskPromise = Promise<{ taskUid: number }> & {
  waitTask(options?: {
    timeout?: number
    interval?: number
  }): Promise<SearchIndexingTask>
}

type IndexLike = {
  updateSearchableAttributes(attributes: string[]): SearchEnqueuedTaskPromise
  updateFilterableAttributes(attributes: string[]): SearchEnqueuedTaskPromise
  updateSortableAttributes(attributes: string[]): SearchEnqueuedTaskPromise
  updateRankingRules(rules: string[]): SearchEnqueuedTaskPromise
  updatePrefixSearch(
    prefixSearch: 'disabled' | 'indexingTime',
  ): SearchEnqueuedTaskPromise
  /** Read-only support probe. See `applyOptionalSetting`. */
  getPrefixSearch(): Promise<string>
  updateStopWords(stopWords: string[]): SearchEnqueuedTaskPromise
  updateTypoTolerance(settings: {
    minWordSizeForTypos: { oneTypo: number; twoTypos: number }
  }): SearchEnqueuedTaskPromise
  addDocuments(
    documents: LegalSearchDocument[],
    options: { primaryKey: 'id' },
  ): SearchEnqueuedTaskPromise
  search(
    query: string,
    options: {
      filter?: string[]
      sort?: string[]
      attributesToRetrieve?: string[]
      limit?: number
      matchingStrategy?: 'all' | 'frequency'
      rankingScoreThreshold?: number
      showRankingScore?: boolean
    },
  ): Promise<{
    hits: unknown[]
    query?: string
    estimatedTotalHits?: number
    processingTimeMs?: number
  }>
}

type IndexSetupClient = {
  createIndex(
    indexName: string,
    options: { primaryKey: 'id' },
  ): SearchEnqueuedTaskPromise
  index(indexName: string): IndexLike
}

type DocumentIndexClient = {
  index(indexName: string): Pick<IndexLike, 'addDocuments'>
}

type DocumentReadClient = {
  index(indexName: string): {
    getDocument(documentId: string): Promise<LegalAuthority>
  }
}

type SearchClient = {
  index(indexName: string): Pick<IndexLike, 'search'>
}

const searchableAttributes = [
  'id',
  'title',
  'neutralCitation',
  'paragraphs.text',
]

/**
 * Meilisearch comparison operators take numeric operands only, so a range
 * filter cannot read the ISO `dateDecided` string. The index carries this
 * derived companion field for range filtering; `dateDecided` remains the
 * authority and the only date the domain schema and callers ever see.
 */
const dateDecidedTimestampField = 'dateDecidedTimestamp'

/**
 * Midnight UTC for an ISO `YYYY-MM-DD` date. Every indexed value lands on a day
 * boundary, so an inclusive `dateTo` needs no end-of-day adjustment: a document
 * decided on the boundary day compares equal, not greater.
 */
function toDateDecidedTimestamp(isoDate: string): number | null {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const timestamp = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  )
  return Number.isNaN(timestamp) ? null : timestamp
}

/**
 * Projects a validated authority into the shape sent to the engine. The schema
 * has already guaranteed `dateDecided` is an ISO date, so a null here means the
 * two have drifted apart rather than that a caller passed something odd.
 */
function toIndexedLegalAuthority(document: LegalAuthority) {
  const timestamp = toDateDecidedTimestamp(document.dateDecided)

  if (timestamp === null) {
    throw new Error(
      `Cannot derive ${dateDecidedTimestampField} for document ${document.id}: dateDecided "${document.dateDecided}" passed schema validation but is not an ISO date.`,
    )
  }

  return { ...document, [dateDecidedTimestampField]: timestamp }
}

const filterableAttributes = [
  'court',
  'jurisdiction',
  'sourceType',
  'dateDecided',
  dateDecidedTimestampField,
]
const sortableAttributes = ['dateDecided']
const legalStopWords = [
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'been',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'with',
]
const legalStopWordSet = new Set(legalStopWords)
const searchSummaryAttributes = [
  'id',
  'title',
  'neutralCitation',
  'court',
  'jurisdiction',
  'dateDecided',
  'sourceType',
  'sourceUrl',
]
const rankingRules = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'exactness',
  'sort',
]
/**
 * The settings createIndex applies, plus the defaults search falls back to,
 * held in one place so callers can report exactly what ran. The benchmark
 * embeds this verbatim, which is what stops a reported tuning decision from
 * quietly disagreeing with the committed value.
 */
export const legalSearchIndexSettings = {
  minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
  prefixSearch: 'disabled',
  matchingStrategy: 'all',
  // Swept across the full benchmark at null, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45
  // and 0.5. Everything from 0.2 to 0.35 beats 0.5 on top-1 and top-3 and is
  // worse on nothing, because the only case the floor is load-bearing for is
  // "claimnt", whose sole candidate scores 0.0928. The lowest legitimate typo
  // match measured is "Rizwun" at 0.3655. 0.25 sits near the middle of that
  // gap, leaving 0.157 of headroom over the junk match and 0.116 under the
  // recall one. The other three no-answer cases return nothing even with the
  // floor removed entirely, so they do not constrain this value.
  //
  // Those scores come from the synthetic benchmark fixture, and ranking scores
  // depend on corpus statistics, so re-measure this on a real corpus before
  // trusting it. See the calibration note in the package README.
  rankingScoreThreshold: 0.25,
  stopWordCount: legalStopWords.length,
} as const

const indexSetupTaskTimeoutMs = 10 * 60_000
const documentIndexingTaskTimeoutMs = 30 * 60_000

export function createClient(host: string, apiKey: string): MeiliSearch {
  return new MeiliSearch({ host, apiKey })
}

/**
 * Search-time parameters this server rejects as unknown.
 *
 * `createIndex` can only discover what an old server cannot be *configured*
 * with. This finds what it cannot be *asked* for, which is a separate gap and
 * was the larger one: Meilisearch added `rankingScoreThreshold` in 1.9, and a
 * 1.8 server answers "Unknown field `rankingScoreThreshold`" to every non-empty
 * query. Left undetected that is 51 of 54 benchmark cases failing as search
 * errors, which looks like a broken index rather than an old server.
 *
 * One probe query, run once, rather than a per-search retry: a retry loop would
 * hide the gap inside every call site and make the numbers depend on which
 * queries happened to be tried.
 */
export async function detectUnsupportedSearchFeatures(
  client: SearchClient,
  indexName: string,
): Promise<string[]> {
  try {
    await client.index(indexName).search('', {
      limit: 1,
      rankingScoreThreshold: legalSearchIndexSettings.rankingScoreThreshold,
    })
    return []
  } catch (error) {
    // MeiliSearchApiError puts the provider's message on `message` itself; the
    // `cause` is the parsed error body, not a string.
    const message = error instanceof Error ? error.message : ''
    if (message.includes('rankingScoreThreshold')) {
      return ['rankingScoreThreshold']
    }
    throw wrapSearchError('Search feature probe failed.', error)
  }
}

export async function createIndex(
  client: IndexSetupClient,
  indexName: string,
  options: SearchIndexOptions = {},
): Promise<SearchIndexResult> {
  let taskUid: number | undefined
  const unsupportedSettings: string[] = []

  try {
    const primaryKey = options.primaryKey ?? 'id'
    const createTask = client.createIndex(indexName, { primaryKey })
    const task = await createTask
    taskUid = task.taskUid
    await waitForSucceededTask(createTask, indexSetupTaskTimeoutMs)
  } catch (error) {
    if (!isIndexAlreadyExistsError(error)) {
      throw wrapSearchError('Search index setup failed.', error)
    }
  }

  try {
    const index = client.index(indexName)
    await waitForSucceededTask(
      index.updateSearchableAttributes(searchableAttributes),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateFilterableAttributes(filterableAttributes),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateSortableAttributes(sortableAttributes),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateRankingRules(rankingRules),
      indexSetupTaskTimeoutMs,
    )
    // Optional only in the sense that an older server cannot be given it. It is
    // load-bearing where it applies: `minimumShortWordPrecision` in the
    // benchmark baseline rests on prefix search being off.
    await applyOptionalSetting(
      'prefixSearch',
      () => index.getPrefixSearch(),
      () => index.updatePrefixSearch(legalSearchIndexSettings.prefixSearch),
      options.allowUnsupportedSettings ?? false,
      unsupportedSettings,
    )
    await waitForSucceededTask(
      index.updateStopWords(legalStopWords),
      indexSetupTaskTimeoutMs,
    )
    await waitForSucceededTask(
      index.updateTypoTolerance({
        minWordSizeForTypos: {
          ...legalSearchIndexSettings.minWordSizeForTypos,
        },
      }),
      indexSetupTaskTimeoutMs,
    )

    return { taskUid, unsupportedSettings }
  } catch (error) {
    throw wrapSearchError('Search index setup failed.', error)
  }
}

export async function indexDocuments(
  client: DocumentIndexClient,
  indexName: string,
  documents: unknown[],
): Promise<SearchIndexDocumentsResult> {
  const parsed = legalAuthoritiesSchema.safeParse(documents)

  if (!parsed.success) {
    return validationFailure(
      documents,
      parsed.error.issues.map((issue) => issue.message),
    )
  }

  const indexable = parsed.data.map(toIndexedLegalAuthority)

  try {
    const task = await client
      .index(indexName)
      .addDocuments(indexable, {
        primaryKey: 'id',
      })
      .waitTask({ timeout: documentIndexingTaskTimeoutMs, interval: 100 })

    if (task.status !== 'succeeded') {
      return indexingTaskFailure(parsed.data, task)
    }

    const indexedCount =
      typeof task.details?.indexedDocuments === 'number'
        ? task.details.indexedDocuments
        : parsed.data.length
    const failedCount = Math.max(parsed.data.length - indexedCount, 0)

    return {
      indexedCount,
      failedCount,
      errors:
        failedCount > 0
          ? [
              {
                recordId: null,
                message:
                  'Indexing task completed without indexing every document.',
              },
            ]
          : [],
    }
  } catch (error) {
    if (isTaskWaitTimeout(error)) {
      throw new Error(
        'Document indexing status timed out. The Meilisearch task may still be running.',
        { cause: error },
      )
    }
    throw wrapSearchError('Document indexing failed.', error)
  }
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
    const searchOptions: {
      filter?: string[]
      sort?: string[]
      attributesToRetrieve?: string[]
      limit?: number
      matchingStrategy?: 'all' | 'frequency'
      rankingScoreThreshold?: number
      showRankingScore?: boolean
    } = {
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
    const result = await client.index(indexName).search(query, searchOptions)
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
      query: result.query ?? query,
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

export function extractLegalSearchSnippets(
  hit: LegalSearchHit,
  query: string,
): LegalSearchSnippet[] {
  const paragraphs = hit.paragraphs ?? []
  const normalizedQuery = normalizeExactMatchValue(query)
  const tokens = normalizedQuery.split(' ').filter((token) => token.length > 1)
  // Normalizing is the expensive part on real judgments, so each paragraph is
  // normalized once here and the result carried through to the mapping step.
  const selectedParagraphs =
    tokens.length > 0
      ? paragraphs
          .map((paragraph, index) => {
            const normalizedText = normalizeExactMatchValue(paragraph.text)
            return {
              paragraph,
              index,
              normalizedText,
              score: snippetMatchScore(normalizedText, normalizedQuery, tokens),
            }
          })
          .filter(({ score }) => score > 0)
          .sort(
            (left, right) =>
              right.score - left.score || left.index - right.index,
          )
          .slice(0, 2)
      : []

  return selectedParagraphs.map(({ paragraph, index, normalizedText }) => ({
    evidenceId: createJudgmentParagraphEvidenceId(hit.id, index + 1),
    paragraphNumber: paragraph.paragraphNumber,
    // Excerpting reads the raw text so the returned snippet keeps its original
    // casing and punctuation.
    text: trimSnippetText(paragraph.text, normalizedText, tokens),
    matchedTerms: matchedSnippetTerms(normalizedText, normalizedQuery, tokens),
    matchReason: 'body_text_match',
  }))
}

/**
 * Anchors evidence to a paragraph's position in the document, not to the number
 * the judgment prints beside it.
 *
 * Those are not the same thing. LegalDocML marks block-quoted paragraphs from a
 * cited judgment as paragraphs in their own right, carrying the quoted case's
 * numbering, and appendices restart at 1. Both put duplicate `paragraphNumber`
 * values in one document — measured at 22 duplicates in a 159-paragraph UKSC
 * judgment, and in 6 of 15 sampled documents across courts. Keying evidence on
 * that number gives two different paragraphs the same evidence id, so a
 * citation cannot identify what it cites.
 *
 * `ordinal` is 1-based position in the document's paragraph array, which the
 * parsers already assign uniquely. `paragraphNumber` is unchanged and remains
 * what a reader is shown, because "at [42]" has to say what the judgment says.
 */
export function createJudgmentParagraphEvidenceId(
  documentId: string,
  ordinal: number,
) {
  return `${documentId}:judgment_paragraph:${ordinal}`
}

function matchedSnippetTerms(
  normalizedText: string,
  normalizedQuery: string,
  tokens: string[],
) {
  if (normalizedQuery && containsWholeTerm(normalizedText, normalizedQuery)) {
    return [normalizedQuery]
  }

  return tokens.filter((token) => containsWholeTerm(normalizedText, token))
}

function snippetMatchScore(
  normalizedText: string,
  normalizedQuery: string,
  tokens: string[],
) {
  if (normalizedQuery && containsWholeTerm(normalizedText, normalizedQuery)) {
    return 3
  }
  if (tokens.every((token) => containsWholeTerm(normalizedText, token)))
    return 2
  if (tokens.some((token) => containsWholeTerm(normalizedText, token))) return 1
  return 0
}

/**
 * Body match tiers read `paragraphs`, falling back to `snippets`. A caller that
 * retrieves neither leaves every hit on tier 0 for body text, so ranking
 * collapses onto the engine score. Pass `includeParagraphs` or `includeSnippets`
 * to `search` if body tiers should participate.
 */
export function rankLegalSearchHitsByExactMatch<T extends LegalSearchHit>(
  hits: T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeExactMatchValue(query)
  if (!normalizedQuery) return hits

  return (
    hits
      .map((hit, index) => ({
        hit,
        index,
        matchTier: legalSearchMatchTier(hit, normalizedQuery),
        engineRankingScore:
          validEngineRankingScore(hit.engineRankingScore) ?? 0,
      }))
      // Legal match tiers express user intent. Engine scores break ties within a
      // tier, then ties preserve the caller's or engine's supplied order. An
      // equal engine score is not equal engine relevance: it is one lossy number
      // summarising the words, typo, proximity, attribute, exactness and sort
      // cascade, so the supplied order still carries signal the score has lost.
      .sort(
        (left, right) =>
          right.matchTier - left.matchTier ||
          right.engineRankingScore - left.engineRankingScore ||
          left.index - right.index,
      )
      .map(({ hit }) => hit)
  )
}

function legalSearchMatchTier(hit: LegalSearchHit, normalizedQuery: string) {
  const normalizedTitle = normalizeExactMatchValue(hit.title)

  if (normalizeExactMatchValue(hit.id) === normalizedQuery) return 8
  if (
    normalizeCitationValue(hit.neutralCitation) ===
    normalizeCitationValue(normalizedQuery)
  )
    return 7
  if (normalizedTitle === normalizedQuery) return 6
  if (containsWholeTerm(normalizedTitle, normalizedQuery)) return 5
  if (containsEveryNormalizedQueryTerm(normalizedTitle, normalizedQuery))
    return 4

  const bodySegments = hit.paragraphs?.length
    ? hit.paragraphs.map(({ text }) => text)
    : (hit.snippets?.map(({ text }) => text) ?? [])
  const normalizedSegments = bodySegments.map(normalizeExactMatchValue)
  if (
    normalizedSegments.some((text) => containsWholeTerm(text, normalizedQuery))
  ) {
    return 3
  }

  const normalizedBody = normalizedSegments.join(' ')
  if (containsEveryNormalizedQueryTerm(normalizedBody, normalizedQuery))
    return 2
  if (containsAnyNormalizedQueryTerm(normalizedBody, normalizedQuery)) return 1
  return 0
}

function readEngineRankingScore(hit: EngineRankingHit) {
  return validEngineRankingScore(hit._rankingScore)
}

function validEngineRankingScore(value: unknown) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
    ? value
    : undefined
}

export const exactMatchPunctuationFolds = [
  ['‘', "'"],
  ['’', "'"],
  ['“', '"'],
  ['”', '"'],
  ['‐', '-'],
  ['‑', '-'],
  ['‒', '-'],
  ['–', '-'],
  ['—', '-'],
  ['―', '-'],
] as const

export const exactMatchPunctuationFrom = exactMatchPunctuationFolds
  .map(([from]) => from)
  .join('')
export const exactMatchPunctuationTo = exactMatchPunctuationFolds
  .map(([, to]) => to)
  .join('')

export function normalizeExactMatchValue(value: string | null | undefined) {
  const punctuationFolded = exactMatchPunctuationFolds.reduce(
    (normalized, [from, to]) => normalized.replaceAll(from, to),
    value?.normalize('NFKC') ?? '',
  )

  return punctuationFolded
    .trim()
    .toLocaleLowerCase('en-GB')
    .replace(/\s+/g, ' ')
}

/**
 * Citation-strength normalization: everything `normalizeExactMatchValue` does,
 * plus dropping leading zeros from digit runs.
 *
 * Tribunals pad the number in a neutral citation and the senior courts do not.
 * Find Case Law returns `[2024] UKUT 00236 (IAC)` and `[2024] UKFTT 001074 (TC)`
 * alongside `[2024] UKSC 22`. A reader types the unpadded form, because that is
 * what the tribunal's own headnote and every citing judgment print, so exact
 * citation matching missed every padded citation and quietly degraded to
 * keyword search across UKUT and UKFTT.
 *
 * Applied to both sides of a citation comparison, never to titles: a title may
 * legitimately contain a zero-padded number that is part of a name.
 */
export function normalizeCitationValue(value: string | null | undefined) {
  return normalizeExactMatchValue(value).replace(
    /(?<![\p{L}\p{M}\p{N}_])0+(\d)/gu,
    '$1',
  )
}

/**
 * Normalizes both arguments before checking that every whitespace-delimited
 * query term appears as a whole term.
 */
export function containsEveryQueryTerm(value: string, query: string) {
  return containsEveryNormalizedQueryTerm(
    normalizeExactMatchValue(value),
    normalizeExactMatchValue(query),
  )
}

/**
 * Whole-term matching that ignores the same words the index ignores, for
 * callers standing in for Meilisearch. Requiring a term the engine drops makes
 * the fallback stricter than the engine it replaces. A query made entirely of
 * stop words matches nothing, which is what the engine returns for one too.
 */
export function containsEverySearchableQueryTerm(value: string, query: string) {
  const normalizedValue = normalizeExactMatchValue(value)
  const searchableTerms = normalizeExactMatchValue(query)
    .split(' ')
    .filter((term) => term && !legalStopWordSet.has(term))

  return (
    searchableTerms.length > 0 &&
    searchableTerms.every((term) => containsWholeTerm(normalizedValue, term))
  )
}

function containsEveryNormalizedQueryTerm(
  normalizedValue: string,
  normalizedQuery: string,
) {
  const terms = normalizedQuery.split(' ').filter(Boolean)
  return (
    terms.length > 0 &&
    terms.every((term) => containsWholeTerm(normalizedValue, term))
  )
}

function containsAnyNormalizedQueryTerm(
  normalizedValue: string,
  normalizedQuery: string,
) {
  const terms = normalizedQuery.split(' ').filter(Boolean)
  return terms.some((term) => containsWholeTerm(normalizedValue, term))
}

// Terms come from user queries, so the key space is unbounded and the cache
// needs an explicit ceiling.
const wholeTermPatterns = new Map<string, RegExp>()
const wholeTermPatternLimit = 500

function wholeTermPattern(term: string) {
  const cached = wholeTermPatterns.get(term)
  if (cached) return cached

  // No `g` or `y` flag, so the pattern holds no `lastIndex` state and stays
  // safe to reuse across calls.
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_])${escapeRegularExpression(term)}(?![\\p{L}\\p{M}\\p{N}_])`,
    'u',
  )
  wholeTermPatterns.set(term, pattern)

  const oldestTerm = wholeTermPatterns.keys().next().value
  if (wholeTermPatterns.size > wholeTermPatternLimit && oldestTerm) {
    wholeTermPatterns.delete(oldestTerm)
  }

  return pattern
}

/**
 * Checks normalized text and term values for a whole-term match. Normalize
 * both inputs with `normalizeExactMatchValue` before calling this helper.
 */
export function containsWholeTerm(value: string, term: string) {
  if (!term) return false
  return wholeTermPattern(term).test(value)
}

function firstWholeTermIndex(value: string, terms: string[]) {
  const indexes = terms
    .map((term) =>
      term ? (wholeTermPattern(term).exec(value)?.index ?? -1) : -1,
    )
    .filter((index) => index >= 0)

  return indexes.length > 0 ? Math.min(...indexes) : -1
}

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimSnippetText(text: string, matchText: string, tokens: string[]) {
  const displayText = text.replace(/\s+/g, ' ').trim()
  const maxLength = 240
  if (displayText.length <= maxLength) return displayText

  // Locating the excerpt with indexOf would centre the window on a substring
  // hit such as "test" inside "testimony", which is the defect whole-term
  // matching removed everywhere else. matchText has already received the
  // index normalization during paragraph selection.
  const matchIndex = Math.max(firstWholeTermIndex(matchText, tokens), 0)
  const normalizedStart = Math.max(matchIndex - 80, 0)
  const matchPrefix = displayText.slice(0, matchIndex)
  // ASCII, precomposed Latin-1 letters, and the folded punctuation are
  // length-preserving under this normalization. For other text, verify that
  // the normalized prefix still maps one-to-one before slicing.
  const offsetsAlign =
    /^[\x20-\x7E\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF‘’“”‐‑‒–—―]*$/u.test(
      matchPrefix,
    ) || normalizeExactMatchValue(`${matchPrefix}x`).length - 1 === matchIndex
  const start = offsetsAlign
    ? normalizedStart
    : normalizedSnippetOffset(displayText, normalizedStart)
  const end = Math.min(start + maxLength, displayText.length)
  const excerpt = displayText.slice(start, end).trim()

  return `${start > 0 ? '...' : ''}${excerpt}${end < displayText.length ? '...' : ''}`
}

function normalizedSnippetOffset(text: string, offset: number) {
  let low = 0
  let high = text.length

  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (normalizeExactMatchValue(text.slice(0, middle)).length < offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low
}

function validationFailure(
  documents: unknown[],
  messages: string[],
): SearchIndexDocumentsResult {
  const recordId = (documents[0] as { id?: unknown } | undefined)?.id

  return {
    indexedCount: 0,
    failedCount: documents.length,
    errors: [
      {
        recordId: typeof recordId === 'string' ? recordId : null,
        message: messages.join('; '),
      },
    ],
  }
}

export async function getDocument(
  client: DocumentReadClient,
  indexName: string,
  documentId: string,
): Promise<LegalAuthority> {
  try {
    const document = await client.index(indexName).getDocument(documentId)
    return LegalAuthoritySchema.parse(document)
  } catch (error) {
    throw wrapSearchError('Document lookup failed.', error)
  }
}

/**
 * A settings route the server does not have, as opposed to a request it
 * rejected. Meilisearch answers 404 for a route that does not exist in its
 * version, and that is the only shape treated as "unsupported": a 400 means the
 * value was wrong, which is a bug here rather than an old server.
 */
function isUnsupportedSettingError(error: unknown) {
  // MeiliSearchApiError carries the raw Response. A 404 from a settings route
  // means the route is absent from this server's version.
  return (
    error instanceof Error &&
    'response' in error &&
    (error.response as Response | undefined)?.status === 404
  )
}

/**
 * Applies a setting the server may not have, checking with a read first.
 *
 * The read is not politeness. Writing to a settings route Meilisearch 1.8.3 does
 * not have returns 404 and then wedges the index: measured with plain curl, a
 * `stop-words` write succeeds 5 times out of 5 on its own at 67ms, and times out
 * 4 times out of 5 when it follows a `prefix-search` write to the absent route.
 * A read of the same absent route is harmless — 5 out of 5, same 67ms — so
 * support is established by reading and the unsupported write is never sent.
 *
 * Catching the write's 404 is therefore not enough. The damage is done by
 * issuing it, and it lands on whatever request comes next, which makes it look
 * like an unrelated flake somewhere downstream.
 */
async function applyOptionalSetting(
  name: string,
  probe: () => Promise<string>,
  task: () => SearchEnqueuedTaskPromise,
  allowUnsupported: boolean,
  unsupported: string[],
) {
  if (allowUnsupported) {
    try {
      await probe()
    } catch (error) {
      if (!isUnsupportedSettingError(error)) throw error
      unsupported.push(name)
      return
    }
  }

  await waitForSucceededTask(task(), indexSetupTaskTimeoutMs)
}

function isTaskWaitTimeout(error: unknown) {
  return error instanceof Error && /timed out|timeout/i.test(error.message)
}

async function waitForSucceededTask(
  task: SearchEnqueuedTaskPromise,
  timeout = 30_000,
): Promise<SearchIndexingTask> {
  const completed = await task.waitTask({ timeout, interval: 100 })
  if (completed.status !== 'succeeded') {
    throw new SearchTaskError(completed)
  }
  return completed
}

function indexingTaskFailure(
  documents: LegalSearchDocument[],
  task: SearchIndexingTask,
): SearchIndexDocumentsResult {
  const taskId = task.uid ?? task.taskUid
  const taskLabel = typeof taskId === 'number' ? ` ${taskId}` : ''
  const errorCode = task.error?.code ?? task.error?.type
  const errorLabel = errorCode ? ` (${errorCode})` : ''

  return {
    indexedCount: 0,
    failedCount: documents.length,
    errors: [
      {
        recordId: null,
        message: `Indexing task${taskLabel} ${task.status ?? 'failed'}${errorLabel}.`,
      },
    ],
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

// The cause contains the unredacted provider error for internal diagnostics such as
// the benchmark report. Never serialise it into an API response or user-facing log.
function wrapSearchError(message: string, error: unknown): Error {
  if (error instanceof SearchTaskError) {
    return new Error(`${message} ${error.message}`, { cause: error })
  }

  const detail = error instanceof Error ? error.name : typeof error
  return new Error(`${message} Search provider error: ${detail}.`, {
    cause: error,
  })
}

function isIndexAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  if (
    'code' in error &&
    (error as { code?: unknown }).code === 'index_already_exists'
  ) {
    return true
  }

  const cause = (error as { cause?: unknown }).cause
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === 'index_already_exists'
  )
}
