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

/**
 * Meilisearch access for the legislation_provisions index. Never the
 * legal_authorities index: provisions are a second corpus with their own
 * searchable, filterable, and ranking configuration, and sharing the
 * judgment index would let provision boilerplate move judgment rankings.
 */

export interface LegislationProvisionDocument {
  /**
   * Meilisearch-safe primary key: the identity path with slashes as
   * hyphens, e.g. ukpga-2020-1-section-13-2. The engine rejects slashes in
   * document ids, so the full path lives in provisionRef instead.
   */
  id: string
  /** Full identity path, e.g. ukpga/2020/1/section/13/2. */
  provisionRef: string
  documentIdentity: string
  actType: string
  year: number
  number: number
  /** Short title of the parent Act, e.g. Equality Act 2010. */
  title: string
  /** Display label, e.g. s. 13(2). */
  label: string
  labelPath: string
  extent: string
  text: string
  hasUnappliedEffects: boolean
  sourceUrl: string
}

export interface LegislationSearchHit extends LegislationProvisionDocument {
  engineRankingScore?: number
}

export interface LegislationSearchResult {
  hits: LegislationSearchHit[]
  query: string
  estimatedTotalHits: number
  processingTimeMs: number
}

export interface LegislationSearchOptions {
  limit?: number
  rankingScoreThreshold?: number | null
  exactPhrase?: string
}

/**
 * Provisional relevance floor 0.35: deliberately not the judgment 0.25 and
 * not derived from the judgment tiers. Provision texts share heavy
 * boilerplate ("a person", "the Secretary of State", "regulations may"),
 * which inflates keyword scores relative to judgment prose, so the judgment
 * floor would admit boilerplate neighbours for short identifier queries.
 * 0.35 is a starting point, not a measurement: re-sweep it against a real
 * provisions corpus the way 0.25 was swept for judgments before trusting it.
 */
export const legislationSearchIndexSettings = {
  minWordSizeForTypos: { oneTypo: 5, twoTypos: 9 },
  prefixSearch: 'disabled',
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
  const record = value as Record<string, unknown>
  // hasUnappliedEffects is required boolean, fail-closed: a row without it
  // is withheld/dropped, never served as current text.
  return (
    typeof record.id === 'string' &&
    typeof record.provisionRef === 'string' &&
    typeof record.documentIdentity === 'string' &&
    typeof record.title === 'string' &&
    typeof record.label === 'string' &&
    typeof record.labelPath === 'string' &&
    typeof record.text === 'string' &&
    typeof record.sourceUrl === 'string' &&
    typeof record.hasUnappliedEffects === 'boolean'
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
        showRankingScore?: boolean
        attributesToRetrieve?: string[]
      },
    ): Promise<{
      hits: unknown[]
      query?: string
      estimatedTotalHits?: number
      processingTimeMs?: number
    }>
  }
}

export async function searchLegislation(
  client: ProvisionSearchClient,
  indexName: string,
  query: string,
  options: LegislationSearchOptions = {},
): Promise<LegislationSearchResult> {
  const searchOptions: {
    limit?: number
    rankingScoreThreshold?: number
    showRankingScore: boolean
  } = { showRankingScore: true }
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
    .search(engineQuery, searchOptions)
  const hits: LegislationSearchHit[] = []
  for (const hit of result.hits) {
    if (!isLegislationProvisionDocument(hit)) continue
    const score = (hit as { _rankingScore?: unknown })._rankingScore
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
  }
}

type ProvisionReadClient = {
  index(indexName: string): {
    getDocument(documentId: string): Promise<Record<string, unknown>>
  }
}

/** Direct provision read for exact citation resolution. Throws when absent. */
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
