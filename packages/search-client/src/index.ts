import { MeiliSearch } from 'meilisearch'
import {
  LegalAuthoritySchema,
  legalAuthoritiesSchema,
  LegalAuthoritySummarySchema,
  type LegalAuthority,
  type LegalAuthoritySummary,
  type LegalSourceType,
} from '@ormont/legal-schema'

export type LegalSearchDocument = LegalAuthority
export type LegalSearchHit = LegalAuthoritySummary & {
  paragraphs?: LegalAuthority['paragraphs']
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

export interface LegalSearchResult {
  hits: LegalSearchHit[]
  query: string
  estimatedTotalHits: number
  processingTimeMs: number
}

export interface LegalSearchOptions {
  includeParagraphs?: boolean
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

    super(`Meilisearch task${taskLabel} ${task.status ?? 'failed'}${errorLabel}.`)
    this.name = 'SearchTaskError'
  }
}

type SearchEnqueuedTaskPromise = Promise<{ taskUid: number }> & {
  waitTask(options?: { timeout?: number; interval?: number }): Promise<SearchIndexingTask>
}

type IndexLike = {
  updateSearchableAttributes(attributes: string[]): SearchEnqueuedTaskPromise
  updateFilterableAttributes(attributes: string[]): SearchEnqueuedTaskPromise
  updateSortableAttributes(attributes: string[]): SearchEnqueuedTaskPromise
  updateRankingRules(rules: string[]): SearchEnqueuedTaskPromise
  addDocuments(documents: LegalSearchDocument[], options: { primaryKey: 'id' }): SearchEnqueuedTaskPromise
  search(
    query: string,
    options: { filter?: string[]; sort?: string[]; attributesToRetrieve?: string[] },
  ): Promise<{
    hits: unknown[]
    query?: string
    estimatedTotalHits?: number
    processingTimeMs?: number
  }>
}

type IndexSetupClient = {
  createIndex(indexName: string, options: { primaryKey: 'id' }): SearchEnqueuedTaskPromise
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
  'court',
  'jurisdiction',
  'paragraphs.text',
]

const filterableAttributes = ['court', 'jurisdiction', 'sourceType', 'dateDecided']
const sortableAttributes = ['dateDecided']
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
    await waitForSucceededTask(createTask)
  } catch (error) {
    if (!isIndexAlreadyExistsError(error)) {
      throw wrapSearchError('Search index setup failed.', error)
    }
  }

  try {
    const index = client.index(indexName)
    await waitForSucceededTask(index.updateSearchableAttributes(searchableAttributes))
    await waitForSucceededTask(index.updateFilterableAttributes(filterableAttributes))
    await waitForSucceededTask(index.updateSortableAttributes(sortableAttributes))
    await waitForSucceededTask(index.updateRankingRules(rankingRules))

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
    return validationFailure(documents, parsed.error.issues.map((issue) => issue.message))
  }

  try {
    const task = await client.index(indexName).addDocuments(parsed.data, {
      primaryKey: 'id',
    }).waitTask({ timeout: 30_000, interval: 100 })

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
          ? [{ recordId: null, message: 'Indexing task completed without indexing every document.' }]
          : [],
    }
  } catch (error) {
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
    const result = await client.index(indexName).search(query, {
      filter: toMeiliFilters(filters),
      sort: ['dateDecided:desc'],
      attributesToRetrieve: options.includeParagraphs
        ? [...searchSummaryAttributes, 'paragraphs']
        : searchSummaryAttributes,
    })
    const hits = result.hits.map((hit) =>
      options.includeParagraphs
        ? LegalAuthoritySchema.parse(hit)
        : LegalAuthoritySummarySchema.parse(hit),
    )
    const rankedHits = rankLegalSearchHitsByExactMatch(hits, query)

    return {
      hits: rankedHits,
      query: result.query ?? query,
      estimatedTotalHits: result.estimatedTotalHits ?? rankedHits.length,
      processingTimeMs: result.processingTimeMs ?? 0,
    }
  } catch (error) {
    throw wrapSearchError('Search failed.', error)
  }
}

export function rankLegalSearchHitsByExactMatch<T extends LegalSearchHit>(
  hits: T[],
  query: string,
): T[] {
  const normalizedQuery = normalizeExactMatchValue(query)
  if (!normalizedQuery) return hits

  return hits
    .map((hit, index) => ({ hit, index, score: exactMatchScore(hit, normalizedQuery) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ hit }) => hit)
}

function exactMatchScore(hit: LegalSearchHit, normalizedQuery: string) {
  if (normalizeExactMatchValue(hit.id) === normalizedQuery) return 3
  if (normalizeExactMatchValue(hit.neutralCitation) === normalizedQuery) return 2
  if (normalizeExactMatchValue(hit.title) === normalizedQuery) return 1
  return 0
}

function normalizeExactMatchValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function validationFailure(documents: unknown[], messages: string[]): SearchIndexDocumentsResult {
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

async function waitForSucceededTask(task: SearchEnqueuedTaskPromise): Promise<SearchIndexingTask> {
  const completed = await task.waitTask({ timeout: 30_000, interval: 100 })
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
  if (filters.jurisdiction) clauses.push(`jurisdiction = ${quoteFilter(filters.jurisdiction)}`)
  if (filters.sourceType) clauses.push(`sourceType = ${quoteFilter(filters.sourceType)}`)
  if (filters.dateFrom) clauses.push(`dateDecided >= ${quoteFilter(filters.dateFrom)}`)
  if (filters.dateTo) clauses.push(`dateDecided <= ${quoteFilter(filters.dateTo)}`)

  return clauses.length > 0 ? clauses : undefined
}

function quoteFilter(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function wrapSearchError(message: string, error: unknown): Error {
  if (error instanceof SearchTaskError) {
    return new Error(`${message} ${error.message}`)
  }

  const detail = error instanceof Error ? error.name : typeof error
  return new Error(`${message} Search provider error: ${detail}.`)
}

function isIndexAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }

  if ('code' in error && (error as { code?: unknown }).code === 'index_already_exists') {
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
