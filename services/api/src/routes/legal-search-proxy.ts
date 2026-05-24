import { Hono } from 'hono'
import { z } from 'zod'
import { LegalAuthoritySchema, type LegalAuthority } from '@ormont/legal-schema'
import {
  createClient,
  getDocument,
  indexDocuments,
  search,
  type LegalSearchFilters,
  type LegalSearchHit,
} from '@ormont/search-client'
import type { ApiErrorResponse } from '@ormont/contracts'
import type { ApiEnv } from '../env'

interface LegalSearchProxyRouteVariables {
  requestId: string
}

interface AtomEntry {
  title: string
  neutralCitation: string
  court: string
  dateDecided: string
  uri: string
  contentHash: string
}

export interface LegalFetchSearchHit extends LegalSearchHit {
  paragraphs?: LegalAuthority['paragraphs']
}

const legalSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/)
  .transform(normalizeCourtCode)
const findCaseLawJurisdiction = 'england-and-wales'
const supportedFindCaseLawCourts = new Set([
  'eat',
  'uksc',
  'ukpc',
  'ewca-civ',
  'ewca-crim',
  'ewcr',
  'ewhc-admin',
  'ewhc-admlty',
  'ewhc-ch',
  'ewhc-comm',
  'ewhc-fam',
  'ewhc-ipec',
  'ewhc-kb',
  'ewhc-mercantile',
  'ewhc-pat',
  'ewhc-scco',
  'ewhc-tcc',
  'ewfc',
  'ewcop',
  'ewcc',
  'ukiptrib',
  'siac',
  'ukist',
  'ukut-aac',
  'ukut-iac',
  'ukut-lc',
  'ukut-tcc',
  'ukftt-credit',
  'ukftt-estate',
  'ukftt-grc',
  'ukftt-hesc',
  'ukftt-tc',
  'ftt-claims',
  'ftt-pc',
  'ftt-phl',
  'ftt-transport',
])

const findCaseLawCourtParamByCourt = new Map(
  Array.from(supportedFindCaseLawCourts, (court) => [court, court.replace(/-/g, '/')]),
)
const storedSearchTimeoutMs = 350

const citationDivisionCourtByBaseCourt = new Map<string, Map<string, string>>([
  [
    'ewhc',
    new Map([
      ['admin', 'ewhc-admin'],
      ['admlty', 'ewhc-admlty'],
      ['ch', 'ewhc-ch'],
      ['comm', 'ewhc-comm'],
      ['fam', 'ewhc-fam'],
      ['ipec', 'ewhc-ipec'],
      ['kb', 'ewhc-kb'],
      ['mercantile', 'ewhc-mercantile'],
      ['pat', 'ewhc-pat'],
      ['scco', 'ewhc-scco'],
      ['tcc', 'ewhc-tcc'],
    ]),
  ],
  [
    'ukut',
    new Map([
      ['aac', 'ukut-aac'],
      ['iac', 'ukut-iac'],
      ['lc', 'ukut-lc'],
      ['tcc', 'ukut-tcc'],
    ]),
  ],
  [
    'ukftt',
    new Map([
      ['credit', 'ukftt-credit'],
      ['estate', 'ukftt-estate'],
      ['grc', 'ukftt-grc'],
      ['hesc', 'ukftt-hesc'],
      ['tc', 'ukftt-tc'],
    ]),
  ],
  [
    'ftt',
    new Map([
      ['claims', 'ftt-claims'],
      ['pc', 'ftt-pc'],
      ['phl', 'ftt-phl'],
      ['transport', 'ftt-transport'],
    ]),
  ],
])

const legalFetchRequestSchema = z.object({
  query: z.string().trim().min(1),
  court: legalSlugSchema.optional(),
  jurisdiction: legalSlugSchema.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
})

const legalDocumentIdSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

function apiError(
  code: ApiErrorResponse['error']['code'],
  message: string,
  requestId: string,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      requestId,
    },
  }
}

export function createLegalSearchProxyRoutes(env: ApiEnv) {
  const app = new Hono<{ Variables: LegalSearchProxyRouteVariables }>()
  const searchClient = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)
  const indexClient = createClient(env.meilisearchHost, env.meilisearchAdminApiKey)
  const mojRateLimiter = createMojRateLimiter(env.mojFindCaseLawRateLimit)

  app.post('/api/search/fetch', async (c) => {
    const requestId = c.get('requestId')
    const parsed = legalFetchRequestSchema.safeParse(await c.req.json().catch(() => null))

    if (!parsed.success || !isSupportedFindCaseLawRequest(parsed.data)) {
      return c.json(
        apiError('validation_failed', 'Fetch search request is invalid.', requestId),
        400,
      )
    }

    const filters = toSearchFilters(parsed.data)
    const cached = await searchStoredAuthorities(
      searchClient,
      env.legalAuthoritiesIndex,
      parsed.data.query,
      filters,
    )

    if (cached.hits.length > 0) {
      return c.json(toFetchResponse(cached.hits, parsed.data.query, true, 0, 0))
    }

    const mojResult = await fetchMojAuthoritySummaries(env, parsed.data, mojRateLimiter)

    if (mojResult.status === 'rate_limited') {
      return c.json(
        {
          ...apiError('storage_unavailable', 'Find Case Law is rate limited.', requestId),
          retryAfter: mojResult.retryAfter,
          cachedHits: cached.hits,
        },
        503,
      )
    }

    if (mojResult.status === 'unavailable') {
      return c.json(
        {
          ...apiError('storage_unavailable', 'Find Case Law is unavailable.', requestId),
          cachedHits: cached.hits,
        },
        503,
      )
    }

    const documents = mojResult.documents.filter((document) =>
      !cached.hits.some((hit) => hit.id === document.id),
    )

    void hydrateAndIndexMojAuthorities(
      env,
      indexClient,
      env.legalAuthoritiesIndex,
      mojResult.entries,
      mojRateLimiter,
    )

    return c.json(
      toFetchResponse(
        documents.map(toHit),
        parsed.data.query,
        false,
        0,
        mojResult.skippedCount,
      ),
    )
  })

  app.get('/api/search/documents/:documentId', async (c) => {
    const requestId = c.get('requestId')
    const parsed = legalDocumentIdSchema.safeParse(c.req.param('documentId'))

    if (!parsed.success) {
      return c.json(
        apiError('validation_failed', 'Document id is invalid.', requestId),
        400,
      )
    }

    const document = await getStoredAuthorityDocument(
      indexClient,
      env.legalAuthoritiesIndex,
      parsed.data,
    )

    if (document) {
      return c.json({ document })
    }

      const liveDocument = await fetchMojAuthorityDocumentById(
        env,
        parsed.data,
        mojRateLimiter,
      )

      if (liveDocument.status === 'ok') {
        void indexFetchedAuthorities(indexClient, env.legalAuthoritiesIndex, [liveDocument.document])
        return c.json({ document: liveDocument.document })
      }

      if (liveDocument.status === 'rate_limited') {
        return c.json(
          {
            ...apiError('storage_unavailable', 'Find Case Law is rate limited.', requestId),
            retryAfter: liveDocument.retryAfter,
          },
          503,
        )
      }

      return c.json(
        apiError('document_not_found', 'Document was not found in stored or live sources.', requestId),
        404,
      )
  })

  return app
}

async function searchStoredAuthorities(
  searchClient: Parameters<typeof search>[0],
  indexName: string,
  query: string,
  filters: LegalSearchFilters,
) {
  try {
    const result = await withTimeout(
      search(searchClient, indexName, query, filters, { includeParagraphs: true }),
      storedSearchTimeoutMs,
    )

    if (result) return result
  } catch {
  }

  return {
    hits: [],
    query,
    estimatedTotalHits: 0,
    processingTimeMs: 0,
  }
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

async function getStoredAuthorityDocument(
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

async function indexFetchedAuthorities(
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

async function fetchMojAuthoritySummaries(
  env: ApiEnv,
  request: z.infer<typeof legalFetchRequestSchema>,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; entries: AtomEntry[]; documents: LegalAuthority[]; skippedCount: number }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  const atomUrl = new URL('/atom.xml', env.mojFindCaseLawBaseUrl)
  atomUrl.searchParams.set('query', request.query)
  if (request.court) atomUrl.searchParams.set('court', toFindCaseLawCourtParam(request.court))

  const atomLimit = rateLimiter.take()
  if (!atomLimit.allowed) {
    return { status: 'rate_limited', retryAfter: atomLimit.retryAfterSeconds.toString() }
  }

  const atomResponse = await fetch(atomUrl)
  if (atomResponse.status === 429) {
    return {
      status: 'rate_limited',
      retryAfter: atomResponse.headers.get('retry-after'),
    }
  }
  if (!atomResponse.ok) {
    return { status: 'unavailable' }
  }

  const entries = parseFindCaseLawAtom(await atomResponse.text(), request)
  const documents = entries.slice(0, 10).map((entry) => atomEntryToAuthoritySummary(env, entry))

  return {
    status: 'ok',
    entries: entries.slice(0, 10),
    documents,
    skippedCount: Math.max(entries.length - documents.length, 0),
  }
}

async function hydrateAndIndexMojAuthorities(
  env: ApiEnv,
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
    const documents = detailResults
      .filter((result): result is { status: 'ok'; document: LegalAuthority } => result.status === 'ok')
      .map((result) => result.document)

    await indexFetchedAuthorities(indexClient, indexName, documents)
  } catch {
    // Live result summaries have already been returned; indexing is best-effort cache hydration.
  }
}

function atomEntryToAuthoritySummary(env: ApiEnv, entry: AtomEntry): LegalAuthority {
  return {
    id: documentIdFromUri(entry.uri),
    title: entry.title,
    neutralCitation: entry.neutralCitation,
    court: entry.court,
    jurisdiction: findCaseLawJurisdiction,
    dateDecided: entry.dateDecided,
    sourceType: 'judgment',
    sourceUrl: new URL(entry.uri, env.mojFindCaseLawBaseUrl).toString(),
  }
}

async function fetchMojAuthorityDetail(
  env: ApiEnv,
  entry: AtomEntry,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; document: LegalAuthority }
  | { status: 'skipped' }
  | { status: 'rate_limited'; retryAfter: string | null }
> {
  const detailUrl = new URL(entry.uri, env.mojFindCaseLawBaseUrl)
  const detailLimit = rateLimiter.take()

  if (!detailLimit.allowed) {
    return { status: 'rate_limited', retryAfter: detailLimit.retryAfterSeconds.toString() }
  }

  const detailResponse = await fetch(detailUrl)

  if (!detailResponse.ok) {
    return { status: 'skipped' }
  }

  const paragraphs = parseJudgmentParagraphs(
    await detailResponse.text(),
    documentIdFromUri(entry.uri),
  )
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

  return { status: 'ok', document: document.data }
}

async function fetchMojAuthorityDocumentById(
  env: ApiEnv,
  documentId: string,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; document: LegalAuthority }
  | { status: 'skipped' }
  | { status: 'rate_limited'; retryAfter: string | null }
> {
  const uri = documentUriFromId(documentId)
  if (!uri) return { status: 'skipped' }

  const limit = rateLimiter.take()
  if (!limit.allowed) {
    return { status: 'rate_limited', retryAfter: limit.retryAfterSeconds.toString() }
  }

  const detailUrl = new URL(uri, env.mojFindCaseLawBaseUrl)
  const detailResponse = await fetch(detailUrl)
  if (!detailResponse.ok) return { status: 'skipped' }

  const html = await detailResponse.text()
  const neutralCitation = extractNeutralCitationFromHtml(html)
  const court = neutralCitation ? courtFromCitation(neutralCitation) : courtFromDocumentId(documentId)
  const dateDecided = extractJudgmentDateFromHtml(html) ?? dateFromDocumentId(documentId)
  const title = extractJudgmentTitleFromHtml(html) ?? neutralCitation ?? documentId

  if (!neutralCitation || !court || !dateDecided) {
    return { status: 'skipped' }
  }

  const document = LegalAuthoritySchema.safeParse({
    id: documentId,
    title,
    neutralCitation,
    court,
    jurisdiction: findCaseLawJurisdiction,
    dateDecided,
    sourceType: 'judgment',
    sourceUrl: detailUrl.toString(),
    paragraphs: parseJudgmentParagraphs(html, documentId),
  })

  if (!document.success) return { status: 'skipped' }

  return { status: 'ok', document: document.data }
}

function createMojRateLimiter(limit: number) {
  const windowMs = 5 * 60 * 1000
  const timestamps: number[] = []

  return {
    take(now = Date.now()) {
      while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
        timestamps.shift()
      }

      if (timestamps.length >= limit) {
        const retryAfterSeconds = Math.ceil((timestamps[0] + windowMs - now) / 1000)
        return { allowed: false as const, retryAfterSeconds }
      }

      timestamps.push(now)
      return { allowed: true as const, retryAfterSeconds: 0 }
    },
  }
}

export function parseFindCaseLawAtom(
  xml: string,
  request: z.infer<typeof legalFetchRequestSchema>,
): AtomEntry[] {
  return Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi))
    .map((match) => parseAtomEntry(match[0]))
    .filter((entry): entry is AtomEntry => entry !== null)
    .filter((entry) => entryMatchesFetchRequest(entry, request))
}

function parseAtomEntry(xml: string): AtomEntry | null {
  const title = decodeXml(readTag(xml, 'title') ?? '')
  const id = readAlternateLink(xml) ?? decodeXml(readTag(xml, 'id') ?? '')
  const updated = decodeXml(readTag(xml, 'published') ?? readTag(xml, 'updated') ?? '')
  const uri = toDocumentUri(id)
  const neutralCitation = extractNeutralCitation(readIdentifier(xml) ?? title)
  const dateDecided = extractDate(updated) ?? extractDate(title)
  const court = neutralCitation ? courtFromCitation(neutralCitation) : null

  if (!title || !uri || !neutralCitation || !court || !dateDecided) {
    return null
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    neutralCitation,
    court,
    dateDecided,
    uri,
    contentHash: decodeXml(readTag(xml, 'tna:contenthash') ?? '') || hashText(xml),
  }
}

function isSupportedFindCaseLawRequest(request: z.infer<typeof legalFetchRequestSchema>) {
  return (
    (!request.court || supportedFindCaseLawCourts.has(request.court)) &&
    (!request.jurisdiction || request.jurisdiction === findCaseLawJurisdiction)
  )
}

function entryMatchesFetchRequest(
  entry: AtomEntry,
  request: z.infer<typeof legalFetchRequestSchema>,
) {
  if (request.court && entry.court !== request.court) return false
  if (request.jurisdiction && request.jurisdiction !== findCaseLawJurisdiction) return false
  if (request.dateFrom && entry.dateDecided < request.dateFrom) return false
  if (request.dateTo && entry.dateDecided > request.dateTo) return false
  return true
}

export function parseJudgmentParagraphs(html: string, documentId: string) {
  const judgmentHtml = extractJudgmentHtml(html)
  const bodyText = decodeHtml(
    judgmentHtml
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )

  return bodyText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(isJudgmentLine)
    .filter((line) => line.length >= 30)
    .slice(0, 80)
    .map((text, index) => ({
      id: `${documentId}-p${index + 1}`,
      documentId,
      paragraphNumber: index + 1,
      text,
    }))
}

function extractJudgmentHtml(html: string) {
  return (
    html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ??
    html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ??
    html
  )
}

function isJudgmentLine(line: string) {
  const lower = line.toLowerCase()
  const excluded = [
    'we place some essential cookies',
    'additional cookies',
    'this information will help us make improvements',
    'access official court judgments',
    'skip to main content',
    'cookie',
    'open justice licence',
  ]

  return !excluded.some((phrase) => lower.includes(phrase))
}

function toSearchFilters(request: z.infer<typeof legalFetchRequestSchema>): LegalSearchFilters {
  return {
    court: request.court,
    jurisdiction: request.jurisdiction,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    sourceType: 'judgment',
  }
}

function toFetchResponse(
  hits: LegalFetchSearchHit[],
  query: string,
  cached: boolean,
  indexedCount: number,
  skippedCount: number,
) {
  return {
    hits,
    query,
    estimatedTotalHits: hits.length,
    processingTimeMs: 0,
    cached,
    indexedCount,
    skippedCount,
  }
}

function toHit(document: LegalAuthority): LegalFetchSearchHit {
  return {
    id: document.id,
    title: document.title,
    neutralCitation: document.neutralCitation,
    court: document.court,
    jurisdiction: document.jurisdiction,
    dateDecided: document.dateDecided,
    sourceType: document.sourceType,
    sourceUrl: document.sourceUrl,
    paragraphs: document.paragraphs,
  }
}

function readTag(xml: string, tag: string) {
  return xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]
}

function readAlternateLink(xml: string) {
  return Array.from(xml.matchAll(/<link\b([^>]*?)\/?>/gi))
    .map((match) => match[1])
    .find((attributes) => /\brel=["']alternate["']/i.test(attributes) && !/\btype=/i.test(attributes))
    ?.match(/\bhref=["']([^"']+)["']/i)?.[1]
}

function readIdentifier(xml: string) {
  return xml.match(/<tna:identifier\b[^>]*type=["']ukncn["'][^>]*>([\s\S]*?)<\/tna:identifier>/i)?.[1]
}

function toDocumentUri(value: string) {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.pathname
  } catch {
    return value.startsWith('/') ? value : `/${value}`
  }
}

function documentIdFromUri(uri: string) {
  return uri.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
}

function documentUriFromId(documentId: string) {
  const court = Array.from(supportedFindCaseLawCourts)
    .sort((left, right) => right.length - left.length)
    .find((supportedCourt) => documentId.startsWith(`${supportedCourt}-`))

  if (!court) return null

  const suffix = documentId.slice(court.length + 1)
  const match = suffix.match(/^(\d{4})-(\d+)$/)
  if (!match) return null

  return `/${toFindCaseLawCourtParam(court)}/${match[1]}/${match[2]}`
}

function courtFromDocumentId(documentId: string) {
  return Array.from(supportedFindCaseLawCourts)
    .sort((left, right) => right.length - left.length)
    .find((court) => documentId.startsWith(`${court}-`)) ?? null
}

function dateFromDocumentId(documentId: string) {
  const year = documentId.match(/-(\d{4})-\d+$/)?.[1]
  return year ? `${year}-01-01` : null
}

const neutralCitationPattern =
  /\[\d{4}\]\s+[A-Za-z][A-Za-z0-9 ]*?\s+\d+(?:\s+\([A-Za-z][A-Za-z0-9 ]*\))?/

function extractNeutralCitation(value: string) {
  return value.match(neutralCitationPattern)?.[0].replace(/\s+/g, ' ').trim()
}

function courtFromCitation(citation: string) {
  const match = citation.match(
    /^\[\d{4}\]\s+([A-Za-z][A-Za-z0-9 ]*?)\s+\d+(?:\s+\(([A-Za-z][A-Za-z0-9 ]*)\))?$/,
  )
  const token = match?.[1]
  const division = match?.[2]

  if (!token) return null

  const court = slugifyCourtToken(token)

  if (division) {
    const divisionCourt = citationDivisionCourtByBaseCourt.get(court)?.get(slugifyCourtToken(division))
    if (divisionCourt) return divisionCourt
  }

  return court && supportedFindCaseLawCourts.has(court) ? court : null
}

function slugifyCourtToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function normalizeCourtCode(value: string) {
  return value.toLowerCase().replace(/\//g, '-')
}

function toFindCaseLawCourtParam(court: string) {
  return findCaseLawCourtParamByCourt.get(court) ?? court
}

function extractDate(value: string) {
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0]
}

function extractJudgmentTitleFromHtml(html: string) {
  const title =
    readTag(html, 'h1') ??
    html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
    ''

  return decodeHtml(
    title
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+-\s+Find Case Law[\s\S]*$/i, '')
      .replace(/\s+/g, ' ')
      .trim(),
  ) || null
}

function extractNeutralCitationFromHtml(html: string) {
  const citationSource =
    html.match(/Neutral Citation Number[\s\S]{0,300}/i)?.[0] ??
    html.match(/judgment-header__neutral-citation[\s\S]{0,300}/i)?.[0] ??
    html

  return extractNeutralCitation(decodeHtml(citationSource.replace(/<[^>]+>/g, ' ')))
}

function extractJudgmentDateFromHtml(html: string) {
  const isoDate = extractDate(html)
  if (isoDate) return isoDate

  const slashDate = html.match(/\bDate:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/i)
  if (!slashDate) return null

  return `${slashDate[3]}-${slashDate[2].padStart(2, '0')}-${slashDate[1].padStart(2, '0')}`
}

function decodeXml(value: string) {
  return decodeHtml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'))
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function hashText(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}
