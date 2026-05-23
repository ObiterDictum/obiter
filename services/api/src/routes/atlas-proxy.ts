import { Hono } from 'hono'
import { z } from 'zod'
import { atlasAuthoritySchema, type AtlasAuthority } from '@ormont/legal-schema'
import {
  createClient,
  getDocument,
  indexDocuments,
  search,
  type AtlasSearchFilters,
  type AtlasSearchHit,
} from '@ormont/search-client'
import type { ApiErrorResponse } from '@ormont/contracts'
import type { ApiEnv } from '../env'

interface AtlasProxyRouteVariables {
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

export interface AtlasFetchSearchHit extends AtlasSearchHit {
  paragraphs?: AtlasAuthority['paragraphs']
}

const atlasSlugSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const findCaseLawJurisdiction = 'england-and-wales'
const supportedFindCaseLawCourts = new Set([
  'uksc',
  'ukpc',
  'ewca-civ',
  'ewca-crim',
  'ewhc-admin',
  'ewhc-ch',
  'ewhc-comm',
  'ewhc-fam',
  'ewhc-kb',
  'ewfc',
  'ewcop',
  'ewcc',
  'ukut',
  'ukftt',
])

const atlasFetchRequestSchema = z.object({
  query: z.string().trim().min(1),
  court: atlasSlugSchema.optional(),
  jurisdiction: atlasSlugSchema.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
})

const atlasDocumentIdSchema = z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

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

export function createAtlasProxyRoutes(env: ApiEnv) {
  const app = new Hono<{ Variables: AtlasProxyRouteVariables }>()
  const searchClient = createClient(env.meilisearchHost, env.meilisearchSearchApiKey)
  const indexClient = createClient(env.meilisearchHost, env.meilisearchAdminApiKey)
  const mojRateLimiter = createMojRateLimiter(env.mojFindCaseLawRateLimit)

  app.post('/api/search/fetch', async (c) => {
    const requestId = c.get('requestId')
    const parsed = atlasFetchRequestSchema.safeParse(await c.req.json().catch(() => null))

    if (!parsed.success || !isSupportedFindCaseLawRequest(parsed.data)) {
      return c.json(
        apiError('validation_failed', 'Atlas fetch search request is invalid.', requestId),
        400,
      )
    }

    const filters = toSearchFilters(parsed.data)
    const cached = await search(
      searchClient,
      env.atlasAuthoritiesIndex,
      parsed.data.query,
      filters,
      { includeParagraphs: true },
    )

    if (cached.hits.length > 0) {
      return c.json(toFetchResponse(cached.hits, parsed.data.query, true, 0, 0))
    }

    const mojResult = await fetchMojAuthorities(env, parsed.data, mojRateLimiter)

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

    const documents = mojResult.documents.filter(
      (document) =>
        !cached.hits.some((hit) => hit.id === document.id) &&
        atlasAuthoritySchema.safeParse(document).success,
    )

    const indexResult =
      documents.length > 0
        ? await indexDocuments(indexClient, env.atlasAuthoritiesIndex, documents)
        : { indexedCount: 0, failedCount: 0, errors: [] }

    return c.json(
      toFetchResponse(
        documents.map(toHit),
        parsed.data.query,
        false,
        indexResult.indexedCount,
        mojResult.skippedCount + indexResult.failedCount,
      ),
    )
  })

  app.get('/api/search/documents/:documentId', async (c) => {
    const requestId = c.get('requestId')
    const parsed = atlasDocumentIdSchema.safeParse(c.req.param('documentId'))

    if (!parsed.success) {
      return c.json(
        apiError('validation_failed', 'Atlas document id is invalid.', requestId),
        400,
      )
    }

    try {
      const document = await getDocument(indexClient, env.atlasAuthoritiesIndex, parsed.data)
      return c.json({ document })
    } catch {
      return c.json(
        apiError('document_not_found', 'Atlas document was not found in the stored index.', requestId),
        404,
      )
    }
  })

  return app
}

async function fetchMojAuthorities(
  env: ApiEnv,
  request: z.infer<typeof atlasFetchRequestSchema>,
  rateLimiter: ReturnType<typeof createMojRateLimiter>,
): Promise<
  | { status: 'ok'; documents: AtlasAuthority[]; skippedCount: number }
  | { status: 'rate_limited'; retryAfter: string | null }
  | { status: 'unavailable' }
> {
  const atomUrl = new URL('/atom.xml', env.mojFindCaseLawBaseUrl)
  atomUrl.searchParams.set('query', request.query)
  if (request.court) atomUrl.searchParams.set('court', request.court)

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
  const documents: AtlasAuthority[] = []
  let skippedCount = 0

  for (const entry of entries.slice(0, 5)) {
    const detailUrl = new URL(entry.uri, env.mojFindCaseLawBaseUrl)
    const detailLimit = rateLimiter.take()
    if (!detailLimit.allowed) {
      return { status: 'rate_limited', retryAfter: detailLimit.retryAfterSeconds.toString() }
    }
    const detailResponse = await fetch(detailUrl)

    if (!detailResponse.ok) {
      skippedCount += 1
      continue
    }

    const paragraphs = parseJudgmentParagraphs(
      await detailResponse.text(),
      documentIdFromUri(entry.uri),
    )
    const document = atlasAuthoritySchema.safeParse({
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
      skippedCount += 1
      continue
    }

    documents.push(document.data)
  }

  return { status: 'ok', documents, skippedCount }
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
  request: z.infer<typeof atlasFetchRequestSchema>,
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

function isSupportedFindCaseLawRequest(request: z.infer<typeof atlasFetchRequestSchema>) {
  return (
    (!request.court || supportedFindCaseLawCourts.has(request.court)) &&
    (!request.jurisdiction || request.jurisdiction === findCaseLawJurisdiction)
  )
}

function entryMatchesFetchRequest(
  entry: AtomEntry,
  request: z.infer<typeof atlasFetchRequestSchema>,
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

function toSearchFilters(request: z.infer<typeof atlasFetchRequestSchema>): AtlasSearchFilters {
  return {
    court: request.court,
    jurisdiction: request.jurisdiction,
    dateFrom: request.dateFrom,
    dateTo: request.dateTo,
    sourceType: 'judgment',
  }
}

function toFetchResponse(
  hits: AtlasFetchSearchHit[],
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

function toHit(document: AtlasAuthority): AtlasFetchSearchHit {
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

function extractNeutralCitation(value: string) {
  return value.match(/\[\d{4}\]\s+[A-Z][A-Z0-9() ]+\s+\d+/)?.[0].replace(/\s+/g, ' ')
}

function courtFromCitation(citation: string) {
  const token = citation.match(/\]\s+([A-Z][A-Z0-9() ]+)\s+\d+$/)?.[1]?.trim().toLowerCase()
  const court = token ? token.replace(/[^a-z0-9]+/g, '-') : null
  return court && supportedFindCaseLawCourts.has(court) ? court : null
}

function extractDate(value: string) {
  return value.match(/\d{4}-\d{2}-\d{2}/)?.[0]
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
