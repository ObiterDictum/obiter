import { MeiliSearch } from 'meilisearch'
import {
  LegalAuthoritySchema,
  legalAuthoritiesSchema,
  LegalAuthoritySummarySchema,
  type LegalAuthority,
  type LegalAuthoritySummary,
  type LegalSourceType,
} from '@obiter/legal-schema'

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
}

export interface SearchIndexResult {
  taskUid?: number
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
    getDocument(documentId: string): Promise<unknown>
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

const filterableAttributes = [
  'court',
  'jurisdiction',
  'sourceType',
  'dateDecided',
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

export async function createIndex(
  client: IndexSetupClient,
  indexName: string,
  options: SearchIndexOptions = {},
): Promise<SearchIndexResult> {
  let taskUid: number | undefined

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
    await waitForSucceededTask(
      index.updatePrefixSearch(legalSearchIndexSettings.prefixSearch),
      indexSetupTaskTimeoutMs,
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

    return { taskUid }
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

  try {
    const task = await client
      .index(indexName)
      .addDocuments(parsed.data, {
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
      filter: toMeiliFilters(filters),
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
      const engineRankingScore = readEngineRankingScore(hit)
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
  const tokens = splitSnippetTerms(normalizedQuery)
  const selectedParagraphs =
    tokens.length > 0
      ? paragraphs
          .map((paragraph, index) => {
            const normalizedText = normalizeExactMatchValue(paragraph.text)
            return {
              paragraph,
              normalizedText,
              index,
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

  return selectedParagraphs.map(({ paragraph, normalizedText }) => ({
    evidenceId: createJudgmentParagraphEvidenceId(
      hit.id,
      paragraph.paragraphNumber,
    ),
    paragraphNumber: paragraph.paragraphNumber,
    text: trimSnippetText(paragraph.text, tokens),
    matchedTerms: matchedSnippetTerms(normalizedText, normalizedQuery, tokens),
    matchReason: 'body_text_match',
  }))
}

export function createJudgmentParagraphEvidenceId(
  documentId: string,
  paragraphNumber: number,
) {
  return `${documentId}:judgment_paragraph:${paragraphNumber}`
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
  if (everyTermPresent(normalizedText, tokens)) return 2
  if (someTermPresent(normalizedText, tokens)) return 1
  return 0
}

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
      // tier only, so they never outweigh a more specific legal match.
      .sort(
        (left, right) =>
          right.matchTier - left.matchTier ||
          right.engineRankingScore - left.engineRankingScore ||
          compareLegalSearchDates(
            left.hit.dateDecided,
            right.hit.dateDecided,
          ) ||
          left.index - right.index,
      )
      .map(({ hit }) => hit)
  )
}

function legalSearchMatchTier(hit: LegalSearchHit, normalizedQuery: string) {
  const normalizedTitle = normalizeExactMatchValue(hit.title)
  const queryTerms = splitQueryTerms(normalizedQuery)

  if (normalizeExactMatchValue(hit.id) === normalizedQuery) return 7
  if (normalizeExactMatchValue(hit.neutralCitation) === normalizedQuery)
    return 6
  if (normalizedTitle === normalizedQuery) return 5
  if (
    containsWholeTerm(normalizedTitle, normalizedQuery) ||
    everyTermPresent(normalizedTitle, queryTerms)
  ) {
    return 4
  }

  // Normalizing is the expensive part on real judgments, so each body segment
  // is normalized once and reused for the phrase, all-term, and any-term tiers.
  const normalizedBodySegments = (
    hit.paragraphs?.length
      ? hit.paragraphs.map(({ text }) => text)
      : (hit.snippets?.map(({ text }) => text) ?? [])
  ).map((text) => normalizeExactMatchValue(text))
  if (
    normalizedBodySegments.some((text) =>
      containsWholeTerm(text, normalizedQuery),
    )
  ) {
    return 3
  }

  const normalizedBody = normalizedBodySegments.join(' ')
  if (everyTermPresent(normalizedBody, queryTerms)) return 2
  if (someTermPresent(normalizedBody, queryTerms)) return 1
  return 0
}

function compareLegalSearchDates(left: unknown, right: unknown) {
  if (typeof left === 'string' && typeof right === 'string') {
    return right < left ? -1 : right > left ? 1 : 0
  }
  if (typeof left === 'string') return -1
  if (typeof right === 'string') return 1
  return 0
}

function readEngineRankingScore(hit: unknown) {
  if (typeof hit !== 'object' || hit === null) return undefined
  return validEngineRankingScore(Reflect.get(hit, '_rankingScore'))
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
 * Normalizes both arguments before checking that every whitespace-delimited
 * query term appears as a whole term.
 */
export function containsEveryQueryTerm(value: string, query: string) {
  return everyTermPresent(
    normalizeExactMatchValue(value),
    splitQueryTerms(normalizeExactMatchValue(query)),
  )
}

function splitQueryTerms(normalizedQuery: string) {
  return normalizedQuery.split(' ').filter(Boolean)
}

function splitSnippetTerms(normalizedQuery: string) {
  return normalizedQuery.split(' ').filter((token) => token.length > 1)
}

function everyTermPresent(normalizedValue: string, terms: string[]) {
  return (
    terms.length > 0 &&
    terms.every((term) => containsWholeTerm(normalizedValue, term))
  )
}

/**
 * Whole-term matching for searchable query terms. Stop-word handling is added
 * by the index-tuning layer above this branch in the search stack.
 */
export function containsEverySearchableQueryTerm(value: string, query: string) {
  return everyTermPresent(
    normalizeExactMatchValue(value),
    splitQueryTerms(normalizeExactMatchValue(query)),
  )
}

function someTermPresent(normalizedValue: string, terms: string[]) {
  return terms.some((term) => containsWholeTerm(normalizedValue, term))
}

// Terms come from user queries, so the key space is unbounded and the cache
// needs an explicit ceiling.
const wholeTermPatterns = new Map<string, RegExp>()
const wholeTermPatternLimit = 500

function wholeTermPattern(term: string) {
  const cached = wholeTermPatterns.get(term)
  if (cached) return cached

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_])${escapeRegularExpression(term)}(?![\\p{L}\\p{M}\\p{N}_])`,
    'u',
  )
  if (wholeTermPatterns.size >= wholeTermPatternLimit) {
    const oldestTerm = wholeTermPatterns.keys().next().value
    if (oldestTerm !== undefined) wholeTermPatterns.delete(oldestTerm)
  }
  wholeTermPatterns.set(term, pattern)

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

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimSnippetText(text: string, tokens: string[]) {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  const maxLength = 240
  if (normalizedText.length <= maxLength) return normalizedText

  const lowerText = normalizedText.toLowerCase()
  const matchIndex =
    tokens
      .map((token) => lowerText.indexOf(token))
      .filter((index) => index >= 0)
      .sort((left, right) => left - right)[0] ?? 0
  const start = Math.max(matchIndex - 80, 0)
  const end = Math.min(start + maxLength, normalizedText.length)
  const excerpt = normalizedText.slice(start, end).trim()

  return `${start > 0 ? '...' : ''}${excerpt}${end < normalizedText.length ? '...' : ''}`
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
    clauses.push(`dateDecided >= ${quoteFilter(filters.dateFrom)}`)
  if (filters.dateTo)
    clauses.push(`dateDecided <= ${quoteFilter(filters.dateTo)}`)

  return clauses.length > 0 ? clauses : undefined
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
