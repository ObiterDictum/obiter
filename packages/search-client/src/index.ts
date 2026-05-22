import { MeiliSearch } from 'meilisearch'
import {
  atlasAuthoritiesSchema,
  atlasAuthoritySummarySchema,
  type AtlasAuthority,
  type AtlasAuthoritySummary,
  type AtlasSourceType,
} from '@ormont/legal-schema'

export type AtlasSearchDocument = AtlasAuthority
export type AtlasSearchHit = AtlasAuthoritySummary
export type AtlasSearchFilters = Partial<{
  court: string
  jurisdiction: string
  sourceType: AtlasSourceType
  dateFrom: string
  dateTo: string
}>

export interface AtlasIndexOptions {
  primaryKey?: 'id'
}

export interface AtlasIndexResult {
  taskUid?: number
}

export interface AtlasIndexDocumentsResult {
  indexedCount: number
  failedCount: number
  errors: Array<{ recordId: string | null; message: string }>
}

export interface AtlasSearchResult {
  hits: AtlasSearchHit[]
  query: string
  estimatedTotalHits: number
  processingTimeMs: number
}

interface AtlasIndexingTask {
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

class AtlasSearchTaskError extends Error {
  constructor(task: AtlasIndexingTask) {
    const taskId = task.uid ?? task.taskUid
    const taskLabel = typeof taskId === 'number' ? ` ${taskId}` : ''
    const errorCode = task.error?.code ?? task.error?.type
    const errorLabel = errorCode ? ` (${errorCode})` : ''

    super(`Meilisearch task${taskLabel} ${task.status ?? 'failed'}${errorLabel}.`)
    this.name = 'AtlasSearchTaskError'
  }
}

type AtlasEnqueuedTaskPromise = Promise<{ taskUid: number }> & {
  waitTask(options?: { timeout?: number; interval?: number }): Promise<AtlasIndexingTask>
}

type IndexLike = {
  updateSearchableAttributes(attributes: string[]): AtlasEnqueuedTaskPromise
  updateFilterableAttributes(attributes: string[]): AtlasEnqueuedTaskPromise
  updateSortableAttributes(attributes: string[]): AtlasEnqueuedTaskPromise
  updateRankingRules(rules: string[]): AtlasEnqueuedTaskPromise
  addDocuments(documents: AtlasSearchDocument[], options: { primaryKey: 'id' }): AtlasEnqueuedTaskPromise
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
  createIndex(indexName: string, options: { primaryKey: 'id' }): AtlasEnqueuedTaskPromise
  index(indexName: string): IndexLike
}

type DocumentIndexClient = {
  index(indexName: string): Pick<IndexLike, 'addDocuments'>
}

type SearchClient = {
  index(indexName: string): Pick<IndexLike, 'search'>
}

const searchableAttributes = [
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
  'sort',
  'exactness',
]

export function createClient(host: string, apiKey: string): MeiliSearch {
  return new MeiliSearch({ host, apiKey })
}

export async function createIndex(
  client: IndexSetupClient,
  indexName: string,
  options: AtlasIndexOptions = {},
): Promise<AtlasIndexResult> {
  let taskUid: number | undefined

  try {
    const primaryKey = options.primaryKey ?? 'id'
    const createTask = client.createIndex(indexName, { primaryKey })
    const task = await createTask
    taskUid = task.taskUid
    await waitForSucceededTask(createTask)
  } catch (error) {
    if (!isIndexAlreadyExistsError(error)) {
      throw wrapSearchError('Atlas search index setup failed.', error)
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
    throw wrapSearchError('Atlas search index setup failed.', error)
  }
}

export async function indexDocuments(
  client: DocumentIndexClient,
  indexName: string,
  documents: unknown[],
): Promise<AtlasIndexDocumentsResult> {
  const parsed = atlasAuthoritiesSchema.safeParse(documents)

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
          ? [{ recordId: null, message: 'Atlas indexing task completed without indexing every document.' }]
          : [],
    }
  } catch (error) {
    throw wrapSearchError('Atlas document indexing failed.', error)
  }
}

export async function search(
  client: SearchClient,
  indexName: string,
  query: string,
  filters: AtlasSearchFilters = {},
): Promise<AtlasSearchResult> {
  try {
    const result = await client.index(indexName).search(query, {
      filter: toMeiliFilters(filters),
      sort: ['dateDecided:desc'],
      attributesToRetrieve: searchSummaryAttributes,
    })
    const hits = result.hits.map((hit) => atlasAuthoritySummarySchema.parse(hit))

    return {
      hits,
      query: result.query ?? query,
      estimatedTotalHits: result.estimatedTotalHits ?? hits.length,
      processingTimeMs: result.processingTimeMs ?? 0,
    }
  } catch (error) {
    throw wrapSearchError('Atlas search failed.', error)
  }
}

function validationFailure(documents: unknown[], messages: string[]): AtlasIndexDocumentsResult {
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

async function waitForSucceededTask(task: AtlasEnqueuedTaskPromise): Promise<AtlasIndexingTask> {
  const completed = await task.waitTask({ timeout: 30_000, interval: 100 })
  if (completed.status !== 'succeeded') {
    throw new AtlasSearchTaskError(completed)
  }
  return completed
}

function indexingTaskFailure(
  documents: AtlasSearchDocument[],
  task: AtlasIndexingTask,
): AtlasIndexDocumentsResult {
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
        message: `Atlas indexing task${taskLabel} ${task.status ?? 'failed'}${errorLabel}.`,
      },
    ],
  }
}

function toMeiliFilters(filters: AtlasSearchFilters): string[] | undefined {
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
  if (error instanceof AtlasSearchTaskError) {
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
