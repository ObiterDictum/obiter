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
  allowUnsupportedSettings?: boolean
}

export interface SearchIndexResult {
  taskUid?: number
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
  maxPayloadBytes?: number
  onProgress?: (progress: IndexDocumentsProgress) => void
}

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
  rankingScoreThreshold?: number | null
  matchingStrategy?: 'all' | 'frequency'
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
