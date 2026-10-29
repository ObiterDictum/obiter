import { MeiliSearch } from 'meilisearch'

export function createClient(host: string, apiKey: string): MeiliSearch {
  return new MeiliSearch({ host, apiKey })
}

export { meilisearchDocumentPayloadMaxBytes } from './document-payload-batches'
export {
  deleteDocuments,
  getDocument,
  listDocumentIds,
} from './index-documents'
export {
  createIndex,
  detectUnsupportedSearchFeatures,
  indexDocuments,
  legalSearchIndexSettings,
  setupIndexWithSettings,
} from './index-settings'
export { getIndexStatus } from './index-status'
export type { SearchIndexDeleteResult } from './index-documents'
export type { ProductIndexSettings } from './index-settings'
export type { SearchIndexState, SearchIndexStatus } from './index-status'
export type {
  IndexDocumentsOptions,
  IndexDocumentsProgress,
  LegalSearchDiagnostics,
  LegalSearchDocument,
  LegalSearchFilters,
  LegalSearchHit,
  LegalSearchMatchReason,
  LegalSearchOptions,
  LegalSearchResult,
  LegalSearchSnippet,
  SearchIndexDocumentsResult,
  SearchIndexOptions,
  SearchIndexResult,
} from './index-types'
export { search, toExactPhraseQuery } from './search-query'
export {
  containsEveryQueryTerm,
  containsWholeTerm,
  createJudgmentParagraphEvidenceId,
  exactMatchPunctuationFolds,
  normalizeCitationValue,
  normalizeExactMatchValue,
  rankLegalSearchHitsByExactMatch,
  titleContainsAnySearchableQueryTerm,
  titleContainsEveryQueryTerm,
} from './search-ranking'
export {
  extractLegalSearchSnippets,
  trimSourceExcerpt,
} from './search-snippets'
export {
  createLegislationIndex,
  getLegislationProvision,
  indexLegislationProvisions,
  isLegislationProvisionDocument,
  legislationSearchIndexSettings as legislationIndexSettings,
  normalizeLegislationQuery,
  searchLegislation,
} from './legislation-index'
export type {
  AppliedLegislationSearchParameters,
  LegislationProvisionDocument,
  LegislationSearchHit,
  LegislationSearchOptions,
  LegislationSearchResult,
} from './legislation-index'
