/**
 * Find Case Law provider primitives: request validation, Atom and HTML parsing,
 * court code mapping, and the provider rate limiter.
 *
 * This package holds the parts of the integration that are pure with respect to
 * how the caller intends to use them. `services/api` uses them for the search
 * request path; bulk ingestion uses the same code for collection walks. There
 * must be exactly one implementation of how a Find Case Law judgment is read,
 * because a second one drifts and then two callers disagree about what a
 * judgment is.
 *
 * Nothing here performs storage or indexing, and nothing depends on the API's
 * environment or database.
 */

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

export {
  parseJudgmentParagraphs,
  extractJudgmentTitleFromHtml,
  extractNeutralCitationFromHtml,
  extractJudgmentDateFromHtml,
} from './html-parser'

export { createMojRateLimiter } from './rate-limiter'

export type {
  AtomFetchLimits,
  FindCaseLawEnv,
  MojRateLimiter,
  ProviderDocumentResult,
  ProviderDocumentSource,
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
