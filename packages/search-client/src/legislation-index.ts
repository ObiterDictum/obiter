import {
  normalizeExactMatchValue,
  setupIndexWithSettings,
  toExactPhraseQuery,
  type SearchIndexDocumentsResult,
  type SearchIndexOptions,
  type SearchIndexResult,
} from './index'
import {
  meilisearchDocumentPayloadMaxBytes,
  partitionByUtf8JsonPayload,
} from './document-payload-batches'

export interface LegislationProvisionDocument {
  id: string
  provisionRef: string
  documentIdentity: string
  actType: string
  year: number
  number: number
  title: string
  label: string
  labelPath: string
  extent: string
  text: string
  hasUnappliedEffects: boolean
  effectsCheckedAt: string | null
  sourceUrl: string
}

export interface LegislationSearchHit extends LegislationProvisionDocument {
  engineRankingScore?: number
}

export interface AppliedLegislationSearchParameters {
  matchingStrategy: 'all' | 'frequency'
  rankingScoreThreshold: number | null
}

export interface LegislationSearchResult {
  hits: LegislationSearchHit[]
  query: string
  estimatedTotalHits: number
  processingTimeMs: number
  appliedSearchParameters: AppliedLegislationSearchParameters
}

export interface LegislationSearchOptions {
  limit?: number
  rankingScoreThreshold?: number | null
  exactPhrase?: string
  signal?: AbortSignal
}

export const legislationSearchIndexSettings = {
  minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
  prefixSearch: 'disabled',
  matchingStrategy: 'all',
  rankingScoreThreshold: 0.35,
} as const

const searchableAttributes = [
  'id',
  'provisionRef',
  'title',
  'label',
  'labelPath',
  'documentIdentity',
  'text',
]
const filterableAttributes = [
  'actType',
  'year',
  'number',
  'documentIdentity',
  'labelPath',
  'extent',
  'hasUnappliedEffects',
]
const sortableAttributes = ['year', 'number']
const rankingRules = [
  'words',
  'typo',
  'proximity',
  'attribute',
  'exactness',
  'sort',
]
const stopWords: string[] = []

export function createLegislationIndex(
  client: Parameters<typeof setupIndexWithSettings>[0],
  indexName: string,
  options: SearchIndexOptions = {},
): Promise<SearchIndexResult> {
  return setupIndexWithSettings(
    client,
    indexName,
    {
      searchableAttributes,
      filterableAttributes,
      sortableAttributes,
      rankingRules,
      prefixSearch: legislationSearchIndexSettings.prefixSearch,
      stopWords,
      minWordSizeForTypos: {
        ...legislationSearchIndexSettings.minWordSizeForTypos,
      },
    },
    options,
  )
}

export function isLegislationProvisionDocument(
  value: unknown,
): value is LegislationProvisionDocument {
  if (typeof value !== 'object' || value === null) return false
  // SAFETY: the non-null object check above makes string-keyed reads sound; every field is individually type-checked below, so the record view grants no unchecked trust.
  const record = value as Record<string, unknown>
  return (
    typeof record.id === 'string' &&
    typeof record.provisionRef === 'string' &&
    typeof record.documentIdentity === 'string' &&
    typeof record.title === 'string' &&
    typeof record.label === 'string' &&
    typeof record.labelPath === 'string' &&
    typeof record.text === 'string' &&
    typeof record.sourceUrl === 'string' &&
    typeof record.hasUnappliedEffects === 'boolean' &&
    (typeof record.effectsCheckedAt === 'string' ||
      record.effectsCheckedAt === null)
  )
}

interface ProvisionIndexTask {
  status?: string
  uid?: number
  taskUid?: number
  details?: { indexedDocuments?: number }
  error?: { code?: string; type?: string } | null
}

type ProvisionIndexClient = {
  index(indexName: string): {
    addDocuments(
      documents: LegislationProvisionDocument[],
      options: { primaryKey: 'id' },
    ): Promise<{ taskUid: number }> & {
      waitTask(options?: {
        timeout?: number
        interval?: number
      }): Promise<ProvisionIndexTask>
    }
  }
}

const documentIndexingTaskTimeoutMs = 30 * 60_000

export async function indexLegislationProvisions(
  client: ProvisionIndexClient,
  indexName: string,
  documents: LegislationProvisionDocument[],
  options: { maxPayloadBytes?: number } = {},
): Promise<SearchIndexDocumentsResult> {
  for (const [index, document] of documents.entries()) {
    if (!isLegislationProvisionDocument(document)) {
      return {
        indexedCount: 0,
        failedCount: documents.length,
        errors: [
          {
            recordId: null,
            message: `Document at index ${index} is not a legislation provision.`,
          },
        ],
      }
    }
  }
  const capBytes = options.maxPayloadBytes ?? meilisearchDocumentPayloadMaxBytes
  const batches = partitionByUtf8JsonPayload(documents, capBytes)
  if (batches.length === 0)
    return { indexedCount: 0, failedCount: 0, errors: [] }
  let indexedCount = 0
  for (const batch of batches) {
    const task = await client
      .index(indexName)
      .addDocuments(batch, { primaryKey: 'id' })
      .waitTask({ timeout: documentIndexingTaskTimeoutMs, interval: 100 })
    if (task.status !== 'succeeded') {
      const errorCode = task.error?.code ?? task.error?.type
      return {
        indexedCount,
        failedCount: documents.length - indexedCount,
        errors: [
          {
            recordId: null,
            message: `Indexing task ${task.status ?? 'failed'}${errorCode ? ` (${errorCode})` : ''}.`,
          },
        ],
      }
    }
    indexedCount +=
      typeof task.details?.indexedDocuments === 'number'
        ? task.details.indexedDocuments
        : batch.length
  }
  return { indexedCount, failedCount: 0, errors: [] }
}

type ProvisionSearchClient = {
  index(indexName: string): {
    search(
      query: string,
      options: {
        limit?: number
        rankingScoreThreshold?: number
        matchingStrategy?: 'all' | 'frequency'
        showRankingScore?: boolean
        attributesToRetrieve?: string[]
      },
      extraRequestInit?: { signal?: AbortSignal | null },
    ): Promise<{
      hits: unknown[]
      query?: string
      estimatedTotalHits?: number
      processingTimeMs?: number
    }>
  }
}

interface LegislationEngineSearchOptions {
  limit?: number
  rankingScoreThreshold?: number
  matchingStrategy: 'all' | 'frequency'
  showRankingScore: boolean
}

export async function searchLegislation(
  client: ProvisionSearchClient,
  indexName: string,
  query: string,
  options: LegislationSearchOptions = {},
): Promise<LegislationSearchResult> {
  const searchOptions: LegislationEngineSearchOptions = {
    matchingStrategy: legislationSearchIndexSettings.matchingStrategy,
    showRankingScore: true,
  }
  if (typeof options.limit === 'number') searchOptions.limit = options.limit
  if (query && options.rankingScoreThreshold !== null) {
    searchOptions.rankingScoreThreshold =
      options.rankingScoreThreshold ??
      legislationSearchIndexSettings.rankingScoreThreshold
  }
  const trimmedPhrase = options.exactPhrase?.trim()
  const engineQuery = trimmedPhrase ? toExactPhraseQuery(trimmedPhrase) : query
  const result = await client
    .index(indexName)
    .search(
      engineQuery,
      searchOptions,
      options.signal ? { signal: options.signal } : undefined,
    )
  const hits: LegislationSearchHit[] = []
  for (const hit of result.hits) {
    if (!isLegislationProvisionDocument(hit)) continue
    const score = '_rankingScore' in hit ? hit._rankingScore : undefined
    hits.push(
      typeof score === 'number' && Number.isFinite(score)
        ? { ...hit, engineRankingScore: score }
        : { ...hit },
    )
  }
  return {
    hits,
    query: trimmedPhrase ? query : (result.query ?? query),
    estimatedTotalHits: result.estimatedTotalHits ?? hits.length,
    processingTimeMs: result.processingTimeMs ?? 0,
    appliedSearchParameters: {
      matchingStrategy: searchOptions.matchingStrategy,
      rankingScoreThreshold: searchOptions.rankingScoreThreshold ?? null,
    },
  }
}

type ProvisionReadClient = {
  index(indexName: string): {
    getDocument(documentId: string): Promise<Record<string, unknown>>
  }
}

export async function getLegislationProvision(
  client: ProvisionReadClient,
  indexName: string,
  provisionId: string,
): Promise<LegislationProvisionDocument> {
  const document = await client.index(indexName).getDocument(provisionId)
  if (!isLegislationProvisionDocument(document)) {
    throw new Error(`Legislation provision ${provisionId} failed validation.`)
  }
  return document
}

export function normalizeLegislationQuery(value: string): string {
  return normalizeExactMatchValue(value)
}
