import {
  LegalAuthoritySchema,
  type LegalAuthority,
  type LegalParagraph,
} from '@obiter/legal-schema'
import { parseFindCaseLawAtom, type AtomEntry } from './atom-parser'
import {
  courtFromCitation,
  findCaseLawJurisdiction,
  toFindCaseLawCourtParam,
} from './court-utils'
import {
  addFindCaseLawDateParams,
  courtFromDocumentId,
  dateFromDocumentId,
  documentIdFromUri,
  documentUriFromId,
  hashText,
  readRelLink,
} from './document-utils'
import {
  extractJudgmentDateFromHtml,
  extractJudgmentTitleFromHtml,
  extractNeutralCitationFromHtml,
  parseJudgmentParagraphs,
} from './html-parser'
import type { createMojRateLimiter } from './rate-limiter'
import type { LegalFetchRequest } from './fetch-schema'
import {
  htmlParser,
  legalDocMlParser,
  parseLegalDocMlParagraphs,
  type ParserIdentity,
} from './legaldocml-parser'

/**
 * Retrieval against Find Case Law. Fetches and parses; it does not store or
 * index. The search request path and bulk ingestion both call these, so that
 * there is one definition of how a judgment is read from the provider.
 */

export type MojRateLimiter = ReturnType<typeof createMojRateLimiter>

/**
 * The provider configuration these functions need. Narrower than the API's
 * environment on purpose: bulk ingestion runs outside the API and should not
 * have to construct an `ApiEnv` to fetch a judgment. `ApiEnv` satisfies this
 * structurally, so API call sites are unchanged.
 */
export interface FindCaseLawEnv {
  mojFindCaseLawBaseUrl: string
}

export interface ProviderSourceMetadata {
  documentUri: string
  sourceUri: string
  xmlUri: string | null
  pdfUri: string | null
  contentHash: string
  rawAtomEntry: string
  rawDocumentHtml?: string
}

/** A stored record, narrowed to what re-fetching actually reads. */
export interface ProviderDocumentSource {
  summary: LegalAuthority
  provider: ProviderSourceMetadata
}

export type ProviderDocumentResult =
  | {
      status: 'ok'
      document: LegalAuthority
      provider: ProviderSourceMetadata
      /**
       * Which parser produced the paragraphs. A corpus that mixes parsers
       * without recording which is which makes later drift undiagnosable: a
       * changed document could be the provider's doing or ours.
       */
      parser: ParserIdentity
      /** Set when LegalDocML was wanted but the HTML path had to be used. */
      fallbackReason?: LegalDocMlFallbackReason
    }
  | { status: 'skipped' }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }

/**
 * Why a judgment was read from HTML rather than from LegalDocML. Recorded and
 * reported rather than swallowed: a rise in any of these is the signal that the
 * provider's XML coverage has changed.
 */
export type LegalDocMlFallbackReason =
  'no_xml_uri' | 'xml_unavailable' | 'xml_unparsable'

export interface DetailFetchOptions {
  /**
   * Read the judgment from LegalDocML `data.xml` instead of the HTML page.
   *
   * Defaults to false so that the search request path keeps the behaviour it
   * shipped with. Bulk ingestion opts in, because paragraph boundaries are the
   * unit its evidence model is built on and the HTML path numbers them by
   * position among extracted blocks rather than by the court's own numbering.
   */
  preferLegalDocMl?: boolean
}

/**
 * Search hydration takes the first page or so. A collection walk takes
 * everything in the slice, so both bounds are caller-supplied rather than fixed
 * at the search path's values.
 */
export interface AtomFetchLimits {
  maxEntries: number
  maxPages: number
}

const searchPathAtomLimits: AtomFetchLimits = { maxEntries: 10, maxPages: 10 }

export async function fetchMojAuthoritySummaries(
  env: FindCaseLawEnv,
  request: LegalFetchRequest,
  rateLimiter: MojRateLimiter,
  limits: AtomFetchLimits = searchPathAtomLimits,
): Promise<
  | {
      status: 'ok'
      entries: AtomEntry[]
      documents: LegalAuthority[]
      skippedCount: number
    }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  const atomUrl = new URL('/atom.xml', env.mojFindCaseLawBaseUrl)
  atomUrl.searchParams.set('query', request.query)
  if (request.court)
    atomUrl.searchParams.set('court', toFindCaseLawCourtParam(request.court))
  addFindCaseLawDateParams(atomUrl, request)

  const entries: AtomEntry[] = []
  const visitedUrls = new Set<string>()
  let nextUrl: URL | null = atomUrl
  let pageCount = 0

  while (
    nextUrl &&
    entries.length < limits.maxEntries &&
    pageCount < limits.maxPages
  ) {
    const pageUrl = nextUrl.toString()
    if (visitedUrls.has(pageUrl)) break
    visitedUrls.add(pageUrl)
    pageCount += 1

    const atomLimit = rateLimiter.take()
    if (!atomLimit.allowed) {
      return {
        status: 'rate_limited',
        retryAfter: atomLimit.retryAfterSeconds.toString(),
      }
    }

    let atomResponse: Response
    try {
      atomResponse = await fetch(nextUrl)
    } catch {
      return { status: 'unavailable' }
    }
    if (atomResponse.status === 429) {
      return {
        status: 'rate_limited',
        retryAfter: atomResponse.headers.get('retry-after'),
      }
    }
    if (!atomResponse.ok) {
      return { status: 'unavailable' }
    }

    const xml = await atomResponse.text()
    entries.push(...parseFindCaseLawAtom(xml, request))
    const nextHref =
      entries.length < limits.maxEntries ? readRelLink(xml, 'next') : null
    nextUrl = nextHref ? new URL(nextHref, nextUrl) : null
  }

  const documents = entries
    .slice(0, limits.maxEntries)
    .map((entry) => atomEntryToAuthoritySummary(env, entry))

  return {
    status: 'ok',
    entries: entries.slice(0, limits.maxEntries),
    documents,
    skippedCount: Math.max(entries.length - documents.length, 0),
  }
}

export function atomEntryToAuthoritySummary(
  env: FindCaseLawEnv,
  entry: AtomEntry,
): LegalAuthority {
  return {
    id: documentIdFromUri(entry.uri),
    title: entry.title,
    neutralCitation: entry.neutralCitation,
    court: entry.court,
    jurisdiction: findCaseLawJurisdiction,
    dateDecided: entry.dateDecided,
    sourceType: 'judgment',
    sourceUrl: new URL(entry.sourceUri, env.mojFindCaseLawBaseUrl).toString(),
  }
}

export function providerMetadataFromAtomEntry(
  entry: AtomEntry,
): ProviderSourceMetadata {
  return {
    documentUri: entry.uri,
    sourceUri: entry.sourceUri,
    xmlUri: entry.xmlUri,
    pdfUri: entry.pdfUri,
    contentHash: entry.contentHash,
    rawAtomEntry: entry.rawXml,
  }
}

/**
 * Reads a judgment from LegalDocML. Returns the reason it could not, so the
 * caller can fall back to HTML and report why rather than silently degrading.
 */
async function fetchLegalDocMlParagraphs(
  env: FindCaseLawEnv,
  entry: AtomEntry,
  documentId: string,
): Promise<
  | { status: 'ok'; paragraphs: LegalParagraph[] }
  | { status: 'fallback'; reason: LegalDocMlFallbackReason }
  | { status: 'rate_limited'; retryAfter: string | null }
> {
  if (!entry.xmlUri) return { status: 'fallback', reason: 'no_xml_uri' }

  const xmlUrl = new URL(entry.xmlUri, env.mojFindCaseLawBaseUrl)

  let response: Response
  try {
    response = await fetch(xmlUrl)
  } catch {
    return { status: 'fallback', reason: 'xml_unavailable' }
  }

  if (response.status === 429) {
    return {
      status: 'rate_limited',
      retryAfter: response.headers.get('retry-after'),
    }
  }

  if (!response.ok) return { status: 'fallback', reason: 'xml_unavailable' }

  const paragraphs = parseLegalDocMlParagraphs(
    await response.text(),
    documentId,
  )
  if (!paragraphs) return { status: 'fallback', reason: 'xml_unparsable' }

  return { status: 'ok', paragraphs }
}

export async function fetchMojAuthorityDetail(
  env: FindCaseLawEnv,
  entry: AtomEntry,
  rateLimiter: MojRateLimiter,
  options: DetailFetchOptions = {},
): Promise<ProviderDocumentResult> {
  const documentId = documentIdFromUri(entry.uri)
  let parser: ParserIdentity = htmlParser
  let fallbackReason: LegalDocMlFallbackReason | undefined
  let legalDocMlParagraphs: LegalParagraph[] | undefined

  if (options.preferLegalDocMl) {
    const xmlLimit = rateLimiter.take()
    if (!xmlLimit.allowed) {
      return {
        status: 'rate_limited',
        retryAfter: xmlLimit.retryAfterSeconds.toString(),
      }
    }

    const xmlResult = await fetchLegalDocMlParagraphs(env, entry, documentId)
    if (xmlResult.status === 'rate_limited') return xmlResult
    if (xmlResult.status === 'ok') {
      legalDocMlParagraphs = xmlResult.paragraphs
      parser = legalDocMlParser
    } else {
      fallbackReason = xmlResult.reason
    }
  }

  const detailUrl = new URL(entry.sourceUri, env.mojFindCaseLawBaseUrl)

  // LegalDocML supplied the paragraphs, so the HTML page is not fetched at all.
  if (legalDocMlParagraphs) {
    const document = LegalAuthoritySchema.safeParse({
      id: documentId,
      title: entry.title,
      neutralCitation: entry.neutralCitation,
      court: entry.court,
      jurisdiction: findCaseLawJurisdiction,
      dateDecided: entry.dateDecided,
      sourceType: 'judgment',
      sourceUrl: detailUrl.toString(),
      paragraphs: legalDocMlParagraphs,
    })

    if (!document.success) return { status: 'skipped' }

    return {
      status: 'ok',
      document: document.data,
      provider: providerMetadataFromAtomEntry(entry),
      parser,
    }
  }

  const detailLimit = rateLimiter.take()

  if (!detailLimit.allowed) {
    return {
      status: 'rate_limited',
      retryAfter: detailLimit.retryAfterSeconds.toString(),
    }
  }

  const detailResponse = await fetch(detailUrl)

  const detailFailure = detailFailureFromResponse(detailResponse)
  if (detailFailure) return detailFailure

  if (!detailResponse.ok) {
    return { status: 'skipped' }
  }

  const html = await detailResponse.text()
  const paragraphs = parseJudgmentParagraphs(html, documentId)
  const document = LegalAuthoritySchema.safeParse({
    id: documentIdFromUri(entry.uri),
    title: entry.title,
    neutralCitation: entry.neutralCitation,
    court: entry.court,
    jurisdiction: findCaseLawJurisdiction,
    dateDecided: entry.dateDecided,
    sourceType: 'judgment',
    sourceUrl: detailUrl.toString(),
    paragraphs,
  })

  if (!document.success) {
    return { status: 'skipped' }
  }

  return {
    status: 'ok',
    document: document.data,
    provider: {
      ...providerMetadataFromAtomEntry(entry),
      rawDocumentHtml: html,
    },
    parser,
    ...(fallbackReason ? { fallbackReason } : {}),
  }
}

export async function fetchMojAuthorityDocumentFromRecord(
  env: FindCaseLawEnv,
  record: ProviderDocumentSource,
  rateLimiter: MojRateLimiter,
): Promise<ProviderDocumentResult> {
  const sourceUris = [record.provider.sourceUri, record.provider.xmlUri].filter(
    (uri): uri is string => Boolean(uri),
  )

  for (const sourceUri of sourceUris) {
    const limit = rateLimiter.take()
    if (!limit.allowed) {
      return {
        status: 'rate_limited',
        retryAfter: limit.retryAfterSeconds.toString(),
      }
    }

    const detailUrl = new URL(sourceUri, env.mojFindCaseLawBaseUrl)
    const detailResponse = await fetch(detailUrl)
    const detailFailure = detailFailureFromResponse(detailResponse)
    if (detailFailure) return detailFailure

    if (!detailResponse.ok) continue

    const html = await detailResponse.text()
    const document = parseMojAuthorityDocument(
      record.summary.id,
      html,
      detailUrl.toString(),
      record.summary,
    )

    if (!document) continue

    return {
      status: 'ok',
      document,
      provider: {
        ...record.provider,
        rawDocumentHtml: html,
      },
      parser: htmlParser,
    }
  }

  return { status: 'skipped' }
}

export async function fetchMojAuthorityDocumentById(
  env: FindCaseLawEnv,
  documentId: string,
  rateLimiter: MojRateLimiter,
): Promise<ProviderDocumentResult> {
  const uri = documentUriFromId(documentId)
  if (!uri) return { status: 'skipped' }

  const limit = rateLimiter.take()
  if (!limit.allowed) {
    return {
      status: 'rate_limited',
      retryAfter: limit.retryAfterSeconds.toString(),
    }
  }

  const detailUrl = new URL(uri, env.mojFindCaseLawBaseUrl)
  const detailResponse = await fetch(detailUrl)
  const detailFailure = detailFailureFromResponse(detailResponse)
  if (detailFailure) return detailFailure

  if (!detailResponse.ok) return { status: 'skipped' }

  const html = await detailResponse.text()
  const document = parseMojAuthorityDocument(
    documentId,
    html,
    detailUrl.toString(),
    {
      id: documentId,
      title: documentId,
      neutralCitation: extractNeutralCitationFromHtml(html) ?? null,
      court: courtFromDocumentId(documentId) ?? '',
      jurisdiction: findCaseLawJurisdiction,
      dateDecided: dateFromDocumentId(documentId) ?? '',
      sourceType: 'judgment',
      sourceUrl: detailUrl.toString(),
    },
  )

  if (!document) return { status: 'skipped' }

  return {
    status: 'ok',
    document,
    provider: {
      documentUri: uri,
      sourceUri: uri,
      xmlUri: null,
      pdfUri: null,
      contentHash: hashText(html),
      rawAtomEntry: '',
      rawDocumentHtml: html,
    },
    parser: htmlParser,
  }
}

function detailFailureFromResponse(response: Response) {
  if (response.status === 429) {
    return {
      status: 'rate_limited' as const,
      retryAfter: response.headers.get('retry-after'),
    }
  }

  if (response.status >= 500) {
    return { status: 'unavailable' as const }
  }

  return null
}

export function parseMojAuthorityDocument(
  documentId: string,
  html: string,
  sourceUrl: string,
  fallback: LegalAuthority,
) {
  const neutralCitation =
    extractNeutralCitationFromHtml(html) ?? fallback.neutralCitation ?? null
  const court =
    (neutralCitation ? courtFromCitation(neutralCitation) : null) ??
    fallback.court
  const dateDecided = extractJudgmentDateFromHtml(html) ?? fallback.dateDecided
  const title =
    extractJudgmentTitleFromHtml(html) ??
    fallback.title ??
    neutralCitation ??
    documentId

  if (!court || !dateDecided) {
    return null
  }

  const document = LegalAuthoritySchema.safeParse({
    id: documentId,
    title,
    neutralCitation,
    court,
    jurisdiction: findCaseLawJurisdiction,
    dateDecided,
    sourceType: 'judgment',
    sourceUrl,
    paragraphs: parseJudgmentParagraphs(html, documentId),
  })

  return document.success ? document.data : null
}
