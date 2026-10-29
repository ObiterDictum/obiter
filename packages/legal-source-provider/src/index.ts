export type { AtomEntry } from './atom-parser'
export {
  parseFindCaseLawAtom,
  isSupportedFindCaseLawRequest,
} from './atom-parser'

export {
  findCaseLawJurisdiction,
  supportedFindCaseLawCourts,
  courtFromFindCaseLawPath,
  courtFromCitation,
  normalizeCourtCode,
  toFindCaseLawCourtParam,
} from './court-utils'

export {
  readTag,
  readAlternateLink,
  readTypedLink,
  readRelLink,
  readIdentifier,
  toDocumentUri,
  documentIdFromUri,
  documentUriFromId,
  courtFromDocumentId,
  dateFromDocumentId,
  extractNeutralCitation,
  addFindCaseLawDateParams,
  extractDate,
  decodeXml,
  decodeHtml,
  hashText,
} from './document-utils'

export type { LegalFetchRequest } from './fetch-schema'
export { legalFetchRequestSchema, legalDocumentIdSchema } from './fetch-schema'

export { resolveProviderUrl, providerDocumentUrl } from './fetch-safety'

export {
  parseJudgmentParagraphs,
  extractJudgmentTitleFromHtml,
  extractNeutralCitationFromHtml,
  extractJudgmentDateFromHtml,
} from './html-parser'

export type { MojRequestBudget, MojRequestCharge } from './rate-limiter'
export { createMojRateLimiter, mojRequestWindowMs } from './rate-limiter'

export type { WithdrawalCandidate, WithdrawnInfo } from './withdrawal'
export { readWithdrawalCandidate, readWithdrawnInfo } from './withdrawal'

export type {
  DetailFetchOptions,
  LegalDocMlFallbackReason,
  AtomFetchLimits,
  FindCaseLawEnv,
  MojRateLimiter,
  ProviderDocumentResult,
  ProviderDocumentSource,
  ProviderFetch,
  ProviderSkipReason,
  ProviderSourceMetadata,
} from './moj-provider'
export {
  atomEntryToAuthoritySummary,
  fetchMojAuthorityDetail,
  fetchMojAuthorityDocumentById,
  fetchMojAuthorityDocumentFromRecord,
  fetchMojAuthoritySummaries,
  parseMojAuthorityDocument,
  providerMetadataFromAtomEntry,
} from './moj-provider'

export type { ParserIdentity } from './legaldocml-parser'
export {
  htmlParser,
  legalDocMlParser,
  parseLegalDocMlParagraphs,
  extractLegalDocMlMetadata,
  extractLegalDocMlJudges,
  extractLegalDocMlPressSummary,
} from './legaldocml-parser'
export type { LegalDocMlPressSummary } from './legaldocml-parser'

export type {
  PublishedCaseLawMetadata,
  PublishedMetadataFailure,
  PublishedMetadataResult,
  PublishedMetadataSourceRecord,
} from './published-metadata'
export { fetchPublishedCaseLawMetadata } from './published-metadata'
