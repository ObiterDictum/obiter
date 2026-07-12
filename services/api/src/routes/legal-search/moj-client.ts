import { LegalAuthoritySchema, type LegalAuthority } from '@obiter/legal-schema'
import { getDocument, indexDocuments } from '@obiter/search-client'
import type { ApiEnv } from '../../env'
import { parseFindCaseLawAtom, type AtomEntry } from './atom-parser'
import { courtFromCitation, findCaseLawJurisdiction, toFindCaseLawCourtParam } from './court-utils'
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
import { createMojRateLimiter } from './rate-limiter'
import {
  type LegalAuthoritySourceStore,
  type ProviderSourceMetadata,
  type StoredLegalAuthorityRecord,
} from './source-store'
import type { LegalFetchRequest } from './fetch-schema'

const storedSearchTimeoutMs = 350

export async function upsertLegalAuthoritySummary(
  legalAuthorityStore: LegalAuthoritySourceStore,
  summary: LegalAuthority,
  provider: ProviderSourceMetadata,
) {
  try {
    await legalAuthorityStore.upsertSummary(summary, provider)
  } catch {
  }
}

export async function upsertLegalAuthorityDocument(
  legalAuthorityStore: LegalAuthoritySourceStore,
  document: LegalAuthority,
  provider: ProviderSourceMetadata,
) {
  await legalAuthorityStore.upsertDocument(document, provider)
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout>

  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<null>((resolve) => {
      timeout = setTimeout(() => resolve(null), timeoutMs)
    }),
  ])
}

export async function getStoredAuthorityDocument(
  indexClient: Parameters<typeof getDocument>[0],
  indexName: string,
  documentId: string,
) {
  try {
    return await withTimeout(
      getDocument(indexClient, indexName, documentId),
      storedSearchTimeoutMs,
    )
  } catch {
    return null
  }
}

export async function indexFetchedAuthorities(
  indexClient: Parameters<typeof indexDocuments>[0],
  indexName: string,
  documents: LegalAuthority[],
) {
  if (documents.length === 0) {
    return { indexedCount: 0, failedCount: 0, errors: [] }
  }

  try {
    return await indexDocuments(indexClient, indexName, documents)
  } catch {
    return {
      indexedCount: 0,
      failedCount: documents.length,
      errors: [],
    }
  }
}

export async function fetchMojAuthoritySummaries(
  env: ApiEnv,
  request: LegalFetchRequest,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; entries: AtomEntry[]; documents: LegalAuthority[]; skippedCount: number }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  const atomUrl = new URL('/atom.xml', env.mojFindCaseLawBaseUrl)
  atomUrl.searchParams.set('query', request.query)
  if (request.court) atomUrl.searchParams.set('court', toFindCaseLawCourtParam(request.court))
  addFindCaseLawDateParams(atomUrl, request)

  const entries: AtomEntry[] = []
  const visitedUrls = new Set<string>()
  let nextUrl: URL | null = atomUrl
  let pageCount = 0

  while (nextUrl && entries.length < 10 && pageCount < 10) {
    const pageUrl = nextUrl.toString()
    if (visitedUrls.has(pageUrl)) break
    visitedUrls.add(pageUrl)
    pageCount += 1

    const atomLimit = rateLimiter.take()
    if (!atomLimit.allowed) {
      return { status: 'rate_limited', retryAfter: atomLimit.retryAfterSeconds.toString() }
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
    const nextHref = entries.length < 10 ? readRelLink(xml, 'next') : null
    nextUrl = nextHref ? new URL(nextHref, nextUrl) : null
  }

  const documents = entries.slice(0, 10).map((entry) => atomEntryToAuthoritySummary(env, entry))

  return {
    status: 'ok',
    entries: entries.slice(0, 10),
    documents,
    skippedCount: Math.max(entries.length - documents.length, 0),
  }
}

export async function hydrateMojAuthoritiesFromSearch(
  env: ApiEnv,
  legalAuthorityStore: LegalAuthoritySourceStore,
  indexClient: Parameters<typeof indexDocuments>[0],
  indexName: string,
  request: LegalFetchRequest,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
) {
  try {
    const mojResult = await fetchMojAuthoritySummaries(env, request, rateLimiter)
    if (mojResult.status !== 'ok') return

    for (const entry of mojResult.entries) {
      await upsertLegalAuthoritySummary(
        legalAuthorityStore,
        atomEntryToAuthoritySummary(env, entry),
        providerMetadataFromAtomEntry(entry),
      )
    }

    await hydrateAndIndexMojAuthorities(
      env,
      legalAuthorityStore,
      indexClient,
      indexName,
      mojResult.entries,
      rateLimiter,
    )
  } catch {
    // Search has already returned from Obiter-owned sources; provider hydration is best effort.
  }
}

export async function hydrateAndIndexMojAuthorities(
  env: ApiEnv,
  legalAuthorityStore: LegalAuthoritySourceStore,
  indexClient: Parameters<typeof indexDocuments>[0],
  indexName: string,
  entries: AtomEntry[],
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
) {
  if (entries.length === 0) return

  try {
    const detailTasks = entries
      .slice(0, 5)
      .map(async (entry) => fetchMojAuthorityDetail(env, entry, rateLimiter))
    const detailResults = await Promise.all(detailTasks)
    const documents: LegalAuthority[] = []
    for (const result of detailResults) {
      if (result.status !== 'ok') continue
      try {
        await upsertLegalAuthorityDocument(legalAuthorityStore, result.document, result.provider)
      } catch {
        continue
      }
      documents.push(result.document)
    }

    await indexFetchedAuthorities(indexClient, indexName, documents)
  } catch {
    // Provider data has already been captured when possible; indexing is best-effort cache hydration.
  }
}

export function atomEntryToAuthoritySummary(env: ApiEnv, entry: AtomEntry): LegalAuthority {
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

export function providerMetadataFromAtomEntry(entry: AtomEntry): ProviderSourceMetadata {
  return {
    documentUri: entry.uri,
    sourceUri: entry.sourceUri,
    xmlUri: entry.xmlUri,
    pdfUri: entry.pdfUri,
    contentHash: entry.contentHash,
    rawAtomEntry: entry.rawXml,
  }
}

async function fetchMojAuthorityDetail(
  env: ApiEnv,
  entry: AtomEntry,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; document: LegalAuthority; provider: ProviderSourceMetadata }
  | { status: 'skipped' }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  const detailUrl = new URL(entry.sourceUri, env.mojFindCaseLawBaseUrl)
  const detailLimit = rateLimiter.take()

  if (!detailLimit.allowed) {
    return { status: 'rate_limited', retryAfter: detailLimit.retryAfterSeconds.toString() }
  }

  const detailResponse = await fetch(detailUrl)

  const detailFailure = detailFailureFromResponse(detailResponse)
  if (detailFailure) return detailFailure

  if (!detailResponse.ok) {
    return { status: 'skipped' }
  }

  const html = await detailResponse.text()
  const paragraphs = parseJudgmentParagraphs(html, documentIdFromUri(entry.uri))
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
  }
}

export async function fetchMojAuthorityDocumentFromRecord(
  env: ApiEnv,
  record: StoredLegalAuthorityRecord,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; document: LegalAuthority; provider: ProviderSourceMetadata }
  | { status: 'skipped' }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  const sourceUris = [record.provider.sourceUri, record.provider.xmlUri].filter(
    (uri): uri is string => Boolean(uri),
  )

  for (const sourceUri of sourceUris) {
    const limit = rateLimiter.take()
    if (!limit.allowed) {
      return { status: 'rate_limited', retryAfter: limit.retryAfterSeconds.toString() }
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
    }
  }

  return { status: 'skipped' }
}

export async function fetchMojAuthorityDocumentById(
  env: ApiEnv,
  documentId: string,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; document: LegalAuthority; provider: ProviderSourceMetadata }
  | { status: 'skipped' }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  const uri = documentUriFromId(documentId)
  if (!uri) return { status: 'skipped' }

  const limit = rateLimiter.take()
  if (!limit.allowed) {
    return { status: 'rate_limited', retryAfter: limit.retryAfterSeconds.toString() }
  }

  const detailUrl = new URL(uri, env.mojFindCaseLawBaseUrl)
  const detailResponse = await fetch(detailUrl)
  const detailFailure = detailFailureFromResponse(detailResponse)
  if (detailFailure) return detailFailure

  if (!detailResponse.ok) return { status: 'skipped' }

  const html = await detailResponse.text()
  const document = parseMojAuthorityDocument(documentId, html, detailUrl.toString(), {
    id: documentId,
    title: documentId,
    neutralCitation: extractNeutralCitationFromHtml(html) ?? null,
    court: courtFromDocumentId(documentId) ?? '',
    jurisdiction: findCaseLawJurisdiction,
    dateDecided: dateFromDocumentId(documentId) ?? '',
    sourceType: 'judgment',
    sourceUrl: detailUrl.toString(),
  })

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

function parseMojAuthorityDocument(
  documentId: string,
  html: string,
  sourceUrl: string,
  fallback: LegalAuthority,
) {
  const neutralCitation = extractNeutralCitationFromHtml(html) ?? fallback.neutralCitation ?? null
  const court = (neutralCitation ? courtFromCitation(neutralCitation) : null) ?? fallback.court
  const dateDecided = extractJudgmentDateFromHtml(html) ?? fallback.dateDecided
  const title = extractJudgmentTitleFromHtml(html) ?? fallback.title ?? neutralCitation ?? documentId

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
