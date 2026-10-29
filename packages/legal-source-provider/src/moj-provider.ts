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
import type { MojRequestBudget } from './rate-limiter'
import type { createMojRateLimiter } from './rate-limiter'
import type { LegalFetchRequest } from './fetch-schema'
import { providerDocumentUrl, resolveProviderUrl } from './fetch-safety'
import {
  htmlParser,
  legalDocMlParser,
  parseLegalDocMlParagraphs,
  type ParserIdentity,
} from './legaldocml-parser'

export type MojRateLimiter = ReturnType<typeof createMojRateLimiter>

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
  acquiredAt?: string
}

export interface ProviderDocumentSource {
  summary: LegalAuthority
  provider: ProviderSourceMetadata
}

export type ProviderSkipReason = 'off_origin' | 'http_error' | 'unparsable'

export type ProviderDocumentResult =
  | {
      status: 'ok'
      document: LegalAuthority
      provider: ProviderSourceMetadata
      parser: ParserIdentity
      fallbackReason?: LegalDocMlFallbackReason
    }
  | { status: 'skipped'; reason: ProviderSkipReason }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }

export type LegalDocMlFallbackReason =
  'no_xml_uri' | 'xml_unavailable' | 'xml_unparsable' | 'xml_off_origin'

export type ProviderFetch = (
  url: URL,
  init: { redirect: 'manual' },
) => Promise<Response>

export interface DetailFetchOptions {
  preferLegalDocMl?: boolean
  fetchImpl?: ProviderFetch
}

export interface AtomFetchLimits {
  maxEntries: number
  maxPages: number
}

const searchPathAtomLimits: AtomFetchLimits = { maxEntries: 10, maxPages: 10 }

export async function fetchMojAuthoritySummaries(
  env: FindCaseLawEnv,
  request: LegalFetchRequest,
  budget: MojRequestBudget,
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

    const charged = await budget.charge()
    if (charged.status === 'unavailable') return { status: 'unavailable' }
    if (charged.status === 'rate_limited') {
      return {
        status: 'rate_limited',
        retryAfter: charged.retryAfterSeconds.toString(),
      }
    }

    let atomResponse: Response
    try {
      atomResponse = await fetch(nextUrl, { redirect: 'manual' })
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
    nextUrl = nextHref
      ? resolveProviderUrl(env.mojFindCaseLawBaseUrl, nextHref)
      : null
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
    sourceUrl: providerDocumentUrl(
      env.mojFindCaseLawBaseUrl,
      entry.sourceUri,
      entry.uri,
    ),
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

async function fetchLegalDocMlParagraphs(
  env: FindCaseLawEnv,
  entry: AtomEntry,
  documentId: string,
  fetchImpl: ProviderFetch,
  budget: MojRequestBudget,
): Promise<
  | { status: 'ok'; paragraphs: LegalParagraph[] }
  | { status: 'fallback'; reason: LegalDocMlFallbackReason }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  if (!entry.xmlUri) return { status: 'fallback', reason: 'no_xml_uri' }

  const xmlUrl = resolveProviderUrl(env.mojFindCaseLawBaseUrl, entry.xmlUri)
  if (!xmlUrl) return { status: 'fallback', reason: 'xml_off_origin' }

  const charged = await budget.charge()
  if (charged.status === 'unavailable') return { status: 'unavailable' }
  if (charged.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfter: charged.retryAfterSeconds.toString(),
    }
  }

  let response: Response
  try {
    response = await fetchImpl(xmlUrl, { redirect: 'manual' })
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
  budget: MojRequestBudget,
  options: DetailFetchOptions = {},
): Promise<ProviderDocumentResult> {
  const documentId = documentIdFromUri(entry.uri)
  const fetchImpl = options.fetchImpl ?? fetch
  let parser: ParserIdentity = htmlParser
  let fallbackReason: LegalDocMlFallbackReason | undefined
  let legalDocMlParagraphs: LegalParagraph[] | undefined

  if (options.preferLegalDocMl) {
    const xmlResult = await fetchLegalDocMlParagraphs(
      env,
      entry,
      documentId,
      fetchImpl,
      budget,
    )
    if (xmlResult.status === 'rate_limited') return xmlResult
    if (xmlResult.status === 'unavailable') return { status: 'unavailable' }
    if (xmlResult.status === 'ok') {
      legalDocMlParagraphs = xmlResult.paragraphs
      parser = legalDocMlParser
    } else {
      fallbackReason = xmlResult.reason
    }
  }

  const detailUrl = resolveProviderUrl(
    env.mojFindCaseLawBaseUrl,
    entry.sourceUri,
  )
  if (!detailUrl) return { status: 'skipped', reason: 'off_origin' }

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

    if (!document.success) return { status: 'skipped', reason: 'unparsable' }

    return {
      status: 'ok',
      document: document.data,
      provider: providerMetadataFromAtomEntry(entry),
      parser,
    }
  }

  const charged = await budget.charge()
  if (charged.status === 'unavailable') return { status: 'unavailable' }
  if (charged.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfter: charged.retryAfterSeconds.toString(),
    }
  }

  const detailResponse = await fetchImpl(detailUrl, { redirect: 'manual' })

  const detailFailure = detailFailureFromResponse(detailResponse)
  if (detailFailure) return detailFailure

  if (!detailResponse.ok) {
    return { status: 'skipped', reason: 'http_error' }
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
    return { status: 'skipped', reason: 'unparsable' }
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
  budget: MojRequestBudget,
): Promise<ProviderDocumentResult> {
  const sourceUris = [record.provider.sourceUri, record.provider.xmlUri].filter(
    (uri): uri is string => Boolean(uri),
  )

  const failures: ProviderSkipReason[] = []

  for (const sourceUri of sourceUris) {
    const detailUrl = resolveProviderUrl(env.mojFindCaseLawBaseUrl, sourceUri)
    if (!detailUrl) {
      failures.push('off_origin')
      continue
    }
    const charged = await budget.charge()
    if (charged.status === 'unavailable') return { status: 'unavailable' }
    if (charged.status === 'rate_limited') {
      return {
        status: 'rate_limited',
        retryAfter: charged.retryAfterSeconds.toString(),
      }
    }
    const detailResponse = await fetch(detailUrl, { redirect: 'manual' })
    const detailFailure = detailFailureFromResponse(detailResponse)
    if (detailFailure) return detailFailure

    if (!detailResponse.ok) {
      failures.push('http_error')
      continue
    }

    const html = await detailResponse.text()
    const document = parseMojAuthorityDocument(
      record.summary.id,
      html,
      detailUrl.toString(),
      record.summary,
    )

    if (!document) {
      failures.push('unparsable')
      continue
    }

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

  const reason: ProviderSkipReason = failures.includes('off_origin')
    ? 'off_origin'
    : failures.includes('http_error')
      ? 'http_error'
      : 'unparsable'
  return { status: 'skipped', reason }
}

export async function fetchMojAuthorityDocumentById(
  env: FindCaseLawEnv,
  documentId: string,
  budget: MojRequestBudget,
): Promise<ProviderDocumentResult> {
  const uri = documentUriFromId(documentId)
  if (!uri) return { status: 'skipped', reason: 'unparsable' }

  const detailUrl = resolveProviderUrl(env.mojFindCaseLawBaseUrl, uri)
  if (!detailUrl) return { status: 'skipped', reason: 'off_origin' }

  const charged = await budget.charge()
  if (charged.status === 'unavailable') return { status: 'unavailable' }
  if (charged.status === 'rate_limited') {
    return {
      status: 'rate_limited',
      retryAfter: charged.retryAfterSeconds.toString(),
    }
  }

  const detailResponse = await fetch(detailUrl, { redirect: 'manual' })
  const detailFailure = detailFailureFromResponse(detailResponse)
  if (detailFailure) return detailFailure

  if (!detailResponse.ok) return { status: 'skipped', reason: 'http_error' }

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

  if (!document) return { status: 'skipped', reason: 'unparsable' }

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
