import type {
  LegalAuthority,
  LegalAuthoritySummary,
  LegalSourceType,
} from '@obiter/legal-schema'

export interface EngineRankingHit {
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
  // One distinctive query term in the title (rank tier 4). Labelled apart
  // from 'title_match' so a card never claims a full title match on
  // single-term evidence; see getLegalSearchMatchReason in the API's
  // response-utils for the wording rationale.
  | 'partial_title_match'
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

export interface IndexDocumentsProgress {
  batchNumber: number
  batchCount: number
  batchDocumentCount: number
  indexedCount: number
  totalDocuments: number
}

export interface IndexDocumentsOptions {
  /**
   * UTF-8 byte cap for `JSON.stringify(batch)` sent to addDocuments.
   * Defaults to {@link meilisearchDocumentPayloadMaxBytes}. Tests pass a
   * smaller value so batching can be asserted without 80 MB fixtures.
   */
  maxPayloadBytes?: number
  onProgress?: (progress: IndexDocumentsProgress) => void
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
  /**
   * Recognised citation surface form. When set, the engine query becomes an
   * exact phrase for that citation instead of the keyword query, so an
   * absent citation returns nothing rather than keyword neighbours. Snippet
   * extraction and tier ranking still read the original query.
   */
  exactPhrase?: string
}

export interface SearchIndexingTask {
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

export type SearchEnqueuedTaskPromise = Promise<{ taskUid: number }> & {
  waitTask(options?: {
    timeout?: number
    interval?: number
  }): Promise<SearchIndexingTask>
}

export type IndexLike = {
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

export type IndexSetupClient = {
  createIndex(
    indexName: string,
    options: { primaryKey: 'id' },
  ): SearchEnqueuedTaskPromise
  index(indexName: string): IndexLike
}

export type DocumentIndexClient = {
  index(indexName: string): Pick<IndexLike, 'addDocuments'>
}

export type DocumentReadClient = {
  index(indexName: string): {
    getDocument(documentId: string): Promise<LegalAuthority>
  }
}

export type SearchClient = {
  index(indexName: string): Pick<IndexLike, 'search'>
}
