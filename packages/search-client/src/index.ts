import { MeiliSearch } from 'meilisearch'
import {
  atlasAuthoritiesSchema,
  atlasAuthoritySchema,
  type AtlasAuthority,
} from '@ormont/legal-schema'

export type AtlasSearchDocument = AtlasAuthority
export type AtlasSearchFilters = Partial<{
  court: string
  jurisdiction: string
  sourceType: string
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
  hits: AtlasSearchDocument[]
  query: string
  estimatedTotalHits: number
  processingTimeMs: number
}

type IndexLike = {
  updateSearchableAttributes(attributes: string[]): Promise<unknown>
  updateFilterableAttributes(attributes: string[]): Promise<unknown>
  updateSortableAttributes(attributes: string[]): Promise<unknown>
  updateRankingRules(rules: string[]): Promise<unknown>
  addDocuments(documents: AtlasSearchDocument[], options: { primaryKey: 'id' }): Promise<unknown>
  search(
    query: string,
    options: { filter?: string[]; sort?: string[] },
  ): Promise<{
    hits: unknown[]
    query?: string
    estimatedTotalHits?: number
    processingTimeMs?: number
  }>
}

type IndexSetupClient = {
  createIndex(indexName: string, options: { primaryKey: 'id' }): Promise<unknown>
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
    const task = (await client.createIndex(indexName, { primaryKey })) as { taskUid?: number }
    taskUid = task.taskUid
  } catch (error) {
    if (!isIndexAlreadyExistsError(error)) {
      throw wrapSearchError('Atlas search index setup failed.', error)
    }
  }

  try {
    const index = client.index(indexName)
    await index.updateSearchableAttributes(searchableAttributes)
    await index.updateFilterableAttributes(filterableAttributes)
    await index.updateSortableAttributes(sortableAttributes)
    await index.updateRankingRules(rankingRules)

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
    await client.index(indexName).addDocuments(parsed.data, { primaryKey: 'id' })
    return {
      indexedCount: parsed.data.length,
      failedCount: 0,
      errors: [],
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
    })
    const hits = result.hits.map((hit) => atlasAuthoritySchema.parse(hit))

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
  return `"${value.replaceAll('"', '\\"')}"`
}

function wrapSearchError(message: string, error: unknown): Error {
  const detail = error instanceof Error ? error.name : typeof error
  return new Error(`${message} Search provider error: ${detail}.`)
}

function isIndexAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'index_already_exists'
  )
}
