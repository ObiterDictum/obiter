import { Hono } from 'hono'
import { z } from 'zod'
import type { Pool, QueryResultRow } from 'pg'
import { LegalAuthoritySchema, type LegalAuthority } from '@ormont/legal-schema'
import {
  createClient,
  getDocument,
  indexDocuments,
  rankLegalSearchHitsByExactMatch,
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
  neutralCitation: string | null
  court: string
  dateDecided: string
  uri: string
  sourceUri: string
  xmlUri: string | null
  pdfUri: string | null
  contentHash: string
  rawXml: string
}

interface ProviderSourceMetadata {
  documentUri: string
  sourceUri: string
  xmlUri: string | null
  pdfUri: string | null
  contentHash: string
  rawAtomEntry: string
  rawDocumentHtml?: string
}

interface StoredLegalAuthorityRecord {
  summary: LegalAuthority
  document?: LegalAuthority
  provider: ProviderSourceMetadata
}

interface LegalAuthoritySourceStore {
  upsertSummary(summary: LegalAuthority, provider: ProviderSourceMetadata): Promise<void>
  upsertDocument(document: LegalAuthority, provider: ProviderSourceMetadata): Promise<void>
  get(documentId: string): Promise<StoredLegalAuthorityRecord | null>
  search(query: string, filters: LegalSearchFilters): Promise<LegalAuthority[]>
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

const findCaseLawCourtParamByCourt = new Map<string, string>(
  Array.from(supportedFindCaseLawCourts, (court) => [court, court.replace(/-/g, '/')] as const),
)
const findCaseLawCourtPathAliases = new Map<string, string>([
  ['ukftt/claims', 'ftt-claims'],
  ['ukftt/pc', 'ftt-pc'],
  ['ukftt/phl', 'ftt-phl'],
  ['ukftt/transport', 'ftt-transport'],
])
const findCaseLawCourtByPath = new Map<string, string>([
  ...Array.from(findCaseLawCourtParamByCourt, ([court, path]) => [path, court] as const),
  ...findCaseLawCourtPathAliases,
])
const storedSearchTimeoutMs = 350
const sourceStoreStatementTimeout = `${storedSearchTimeoutMs}ms`

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
      ['claims', 'ftt-claims'],
      ['pc', 'ftt-pc'],
      ['phl', 'ftt-phl'],
      ['tc', 'ukftt-tc'],
      ['transport', 'ftt-transport'],
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

type LegalFetchRequest = z.infer<typeof legalFetchRequestSchema>

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

function createInMemoryLegalAuthoritySourceStore(): LegalAuthoritySourceStore {
  const records = new Map<string, StoredLegalAuthorityRecord>()

  return {
    async upsertSummary(summary: LegalAuthority, provider: ProviderSourceMetadata) {
      const existing = records.get(summary.id)
      records.set(summary.id, {
        summary,
        document: existing?.document,
        provider: {
          ...existing?.provider,
          ...provider,
        },
      })
    },
    async upsertDocument(document: LegalAuthority, provider: ProviderSourceMetadata) {
      const existing = records.get(document.id)
      records.set(document.id, {
        summary: existing?.summary ?? toAuthoritySummary(document),
        document,
        provider: {
          ...existing?.provider,
          ...provider,
        },
      })
    },
    async get(documentId: string) {
      return records.get(documentId) ?? null
    },
    async search(query: string, filters: LegalSearchFilters) {
      const normalizedQuery = normalizeSearchText(query)
      const dateOrderedMatches = Array.from(records.values())
        .map((record) => record.document ?? record.summary)
        .filter((document) => documentMatchesSearch(document, normalizedQuery, filters))
        .sort((left, right) => right.dateDecided.localeCompare(left.dateDecided))

      return rankLegalSearchHitsByExactMatch(dateOrderedMatches, query)
        .slice(0, 10)
    },
  }
}

interface LegalAuthoritySourceRow extends QueryResultRow {
  summary_json: unknown
  document_json: unknown | null
  provider_json: ProviderSourceMetadata
}

export function createPostgresLegalAuthoritySourceStore(pool: Pool): LegalAuthoritySourceStore {
  return {
    async upsertSummary(summary, provider) {
      await pool.query(
        `
          insert into legal_source_documents (
            document_id,
            summary_json,
            provider_json,
            content_hash,
            source_uri,
            xml_uri,
            pdf_uri,
            updated_at
          )
          values ($1, $2::jsonb, $3::jsonb, $4, $5, $6, $7, now())
          on conflict (document_id) do update set
            summary_json = excluded.summary_json,
            provider_json = legal_source_documents.provider_json || excluded.provider_json,
            content_hash = excluded.content_hash,
            source_uri = excluded.source_uri,
            xml_uri = excluded.xml_uri,
            pdf_uri = excluded.pdf_uri,
            updated_at = now()
        `,
        [
          summary.id,
          JSON.stringify(summary),
          JSON.stringify(provider),
          provider.contentHash,
          provider.sourceUri,
          provider.xmlUri,
          provider.pdfUri,
        ],
      )
    },
    async upsertDocument(document, provider) {
      const summary = toAuthoritySummary(document)
      await pool.query(
        `
          insert into legal_source_documents (
            document_id,
            summary_json,
            document_json,
            provider_json,
            content_hash,
            source_uri,
            xml_uri,
            pdf_uri,
            updated_at
          )
          values ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6, $7, $8, now())
          on conflict (document_id) do update set
            summary_json = excluded.summary_json,
            document_json = excluded.document_json,
            provider_json = legal_source_documents.provider_json || excluded.provider_json,
            content_hash = excluded.content_hash,
            source_uri = excluded.source_uri,
            xml_uri = excluded.xml_uri,
            pdf_uri = excluded.pdf_uri,
            updated_at = now()
        `,
        [
          document.id,
          JSON.stringify(summary),
          JSON.stringify(document),
          JSON.stringify(provider),
          provider.contentHash,
          provider.sourceUri,
          provider.xmlUri,
          provider.pdfUri,
        ],
      )
    },
    async get(documentId) {
      const result = await pool.query<LegalAuthoritySourceRow>(
        `
          select summary_json, document_json, provider_json
          from legal_source_documents
          where document_id = $1
        `,
        [documentId],
      )

      return toStoredLegalAuthorityRecord(result.rows[0])
    },
    async search(query, filters) {
      const normalizedQuery = normalizeSearchText(query)
      const client = await pool.connect()

      try {
        await client.query('begin')
        await client.query('select set_config($1, $2, true)', [
          'statement_timeout',
          sourceStoreStatementTimeout,
        ])

        const result = await client.query<LegalAuthoritySourceRow>(
          `
            select summary_json, document_json, provider_json
            from legal_source_documents
            where ($1::text is null or summary_json->>'court' = $1)
              and ($2::text is null or summary_json->>'jurisdiction' = $2)
              and ($3::text is null or summary_json->>'sourceType' = $3)
              and ($4::text is null or summary_json->>'dateDecided' >= $4)
              and ($5::text is null or summary_json->>'dateDecided' <= $5)
              and (
                $6::text = ''
                or search_vector @@ websearch_to_tsquery('english', $6)
                or regexp_replace(lower(trim(coalesce(summary_json->>'id', ''))), '\\s+', ' ', 'g') = $7
                or regexp_replace(lower(trim(coalesce(summary_json->>'neutralCitation', ''))), '\\s+', ' ', 'g') = $7
                or regexp_replace(lower(trim(coalesce(summary_json->>'title', ''))), '\\s+', ' ', 'g') = $7
              )
            order by
              case
                when regexp_replace(
                  lower(trim(coalesce(summary_json->>'id', ''))),
                  '\\s+',
                  ' ',
                  'g'
                ) = $7 then 3
                when regexp_replace(
                  lower(trim(coalesce(summary_json->>'neutralCitation', ''))),
                  '\\s+',
                  ' ',
                  'g'
                ) = $7 then 2
                when regexp_replace(
                  lower(trim(coalesce(summary_json->>'title', ''))),
                  '\\s+',
                  ' ',
                  'g'
                ) = $7 then 1
                else 0
              end desc,
              ts_rank_cd(search_vector, websearch_to_tsquery('english', $6)) desc,
              summary_json->>'dateDecided' desc
            limit 10
          `,
          [
            filters.court ?? null,
            filters.jurisdiction ?? null,
            filters.sourceType ?? null,
            filters.dateFrom ?? null,
            filters.dateTo ?? null,
            normalizedQuery,
            normalizedQuery,
          ],
        )
        await client.query('commit')

        const documents = result.rows
          .map((row) => {
            const record = toStoredLegalAuthorityRecord(row)
            return record?.document ?? record?.summary
          })
          .filter((document): document is LegalAuthority => Boolean(document))

        return rankLegalSearchHitsByExactMatch(documents, query)
      } catch (error) {
        await client.query('rollback').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
  }
}

function toStoredLegalAuthorityRecord(row?: LegalAuthoritySourceRow): StoredLegalAuthorityRecord | null {
  if (!row) return null

  const summary = LegalAuthoritySchema.parse(row.summary_json)
  const document = row.document_json ? LegalAuthoritySchema.parse(row.document_json) : undefined

  return {
    summary,
    document,
    provider: row.provider_json,
  }
}

function toAuthoritySummary(document: LegalAuthority): LegalAuthority {
  return {
    id: document.id,
    title: document.title,
    neutralCitation: document.neutralCitation,
    court: document.court,
    jurisdiction: document.jurisdiction,
    dateDecided: document.dateDecided,
    sourceType: document.sourceType,
    sourceUrl: document.sourceUrl,
  }
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim()
}

function documentMatchesSearch(
  document: LegalAuthority,
  normalizedQuery: string,
  filters: LegalSearchFilters,
) {
  if (filters.court && document.court !== filters.court) return false
  if (filters.jurisdiction && document.jurisdiction !== filters.jurisdiction) return false
  if (filters.sourceType && document.sourceType !== filters.sourceType) return false
  if (filters.dateFrom && document.dateDecided < filters.dateFrom) return false
  if (filters.dateTo && document.dateDecided > filters.dateTo) return false

  const haystack = normalizeSearchText(
    [
      document.id,
      document.title,
      document.neutralCitation,
    ].join(' '),
  )
  const tokens = normalizedQuery.split(' ').filter(Boolean)

  return tokens.length === 0 || tokens.every((token) => haystack.includes(token))
}

export function createLegalSearchProxyRoutes(
  env: ApiEnv,
  legalAuthorityStore: LegalAuthoritySourceStore = createInMemoryLegalAuthoritySourceStore(),
) {
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
      return c.json(
        toFetchResponse(cached.hits.map(toSummaryHit), parsed.data.query, true, 0, 0),
      )
    }

    const storedDocuments = await searchLegalAuthoritySourceStore(
      legalAuthorityStore,
      parsed.data.query,
      filters,
    )
    if (storedDocuments.length > 0) {
      const rankedStoredDocuments = rankLegalSearchHitsByExactMatch(
        storedDocuments,
        parsed.data.query,
      )

      return c.json(
        toFetchResponse(rankedStoredDocuments.map(toSummaryHit), parsed.data.query, true, 0, 0),
      )
    }

    void hydrateMojAuthoritiesFromSearch(
      env,
      legalAuthorityStore,
      indexClient,
      env.legalAuthoritiesIndex,
      parsed.data,
      mojRateLimiter,
    )

    return c.json(
      toFetchResponse(
        [],
        parsed.data.query,
        false,
        0,
        0,
        true,
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

    const sourceRecord = await getLegalAuthoritySourceRecord(legalAuthorityStore, parsed.data)
    if (sourceRecord?.document) {
      return c.json({ document: sourceRecord.document })
    }

    const liveDocument = sourceRecord
      ? await fetchMojAuthorityDocumentFromRecord(env, sourceRecord, mojRateLimiter)
      : await fetchMojAuthorityDocumentById(env, parsed.data, mojRateLimiter)

    if (liveDocument.status === 'ok') {
      try {
        await upsertLegalAuthorityDocument(
          legalAuthorityStore,
          liveDocument.document,
          liveDocument.provider,
        )
      } catch {
        return c.json(
          apiError(
            'storage_unavailable',
            'Legal source storage is unavailable.',
            requestId,
          ),
          503,
        )
      }
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

    if (liveDocument.status === 'unavailable') {
      return c.json(
        apiError('storage_unavailable', 'Find Case Law is unavailable.', requestId),
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
      search(searchClient, indexName, query, filters),
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

async function searchLegalAuthoritySourceStore(
  legalAuthorityStore: LegalAuthoritySourceStore,
  query: string,
  filters: LegalSearchFilters,
) {
  try {
    return (await withTimeout(
      legalAuthorityStore.search(query, filters),
      storedSearchTimeoutMs,
    )) ?? []
  } catch {
    return []
  }
}

async function getLegalAuthoritySourceRecord(
  legalAuthorityStore: LegalAuthoritySourceStore,
  documentId: string,
) {
  try {
    return await withTimeout(legalAuthorityStore.get(documentId), storedSearchTimeoutMs)
  } catch {
    return null
  }
}

async function upsertLegalAuthoritySummary(
  legalAuthorityStore: LegalAuthoritySourceStore,
  summary: LegalAuthority,
  provider: ProviderSourceMetadata,
) {
  try {
    await legalAuthorityStore.upsertSummary(summary, provider)
  } catch {
  }
}

async function upsertLegalAuthorityDocument(
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

    const atomResponse = await fetch(nextUrl)
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

async function hydrateMojAuthoritiesFromSearch(
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
    // Search has already returned from Ormont-owned sources; provider hydration is best effort.
  }
}

async function hydrateAndIndexMojAuthorities(
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

function atomEntryToAuthoritySummary(env: ApiEnv, entry: AtomEntry): LegalAuthority {
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

function providerMetadataFromAtomEntry(entry: AtomEntry): ProviderSourceMetadata {
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

async function fetchMojAuthorityDocumentFromRecord(
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

async function fetchMojAuthorityDocumentById(
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
  const normalizedRequest: z.infer<typeof legalFetchRequestSchema> = {
    ...request,
    court: request.court ? normalizeCourtCode(request.court) : undefined,
  }

  return Array.from(xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi))
    .map((match) => parseAtomEntry(match[0], normalizedRequest))
    .filter((entry): entry is AtomEntry => entry !== null)
    .filter((entry) => entryMatchesFetchRequest(entry, normalizedRequest))
}

function parseAtomEntry(
  xml: string,
  request: z.infer<typeof legalFetchRequestSchema>,
): AtomEntry | null {
  const title = decodeXml(readTag(xml, 'title') ?? '')
  const source = readAlternateLink(xml) ?? decodeXml(readTag(xml, 'id') ?? '')
  const sourceUri = toDocumentUri(source)
  const documentUri = toDocumentUri(decodeXml(readTag(xml, 'tna:uri') ?? '')) ?? sourceUri
  const xmlUri =
    readTypedLink(xml, 'application/xml') ??
    (sourceUri ? `${sourceUri.replace(/\/$/, '')}/data.xml` : null)
  const pdfUri = readTypedLink(xml, 'application/pdf') ?? null
  const updated = decodeXml(readTag(xml, 'published') ?? readTag(xml, 'updated') ?? '')
  const neutralCitation = extractNeutralCitation(readIdentifier(xml) ?? title) ?? null
  const dateDecided = extractDate(updated) ?? extractDate(title)
  const court =
    (neutralCitation ? courtFromCitation(neutralCitation) : null) ??
    courtFromFindCaseLawPath(sourceUri) ??
    courtFromFindCaseLawPath(documentUri) ??
    request.court ??
    null

  if (!title || !documentUri || !sourceUri || !court || !dateDecided) {
    return null
  }

  return {
    title: title.replace(/\s+/g, ' ').trim(),
    neutralCitation,
    court,
    dateDecided,
    uri: documentUri,
    sourceUri,
    xmlUri,
    pdfUri,
    contentHash: decodeXml(readTag(xml, 'tna:contenthash') ?? '') || hashText(xml),
    rawXml: xml,
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
  const structuredBlocks = Array.from(judgmentHtml.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi))
    .map((match) => htmlFragmentToText(match[2]))
  const fallbackBlocks = htmlFragmentToText(
    judgmentHtml.replace(/<\/(p|div|li|h[1-6])>/gi, '\n'),
  ).split(/\n+/)
  const bodyBlocks = structuredBlocks.length > 0 ? structuredBlocks : fallbackBlocks

  return bodyBlocks
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter(isJudgmentLine)
    .map((text, index) => ({
      id: `${documentId}-p${index + 1}`,
      documentId,
      paragraphNumber: index + 1,
      text,
    }))
}

function htmlFragmentToText(html: string) {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
      .replace(/<header\b[\s\S]*?<\/header>/gi, ' ')
      .replace(/<footer\b[\s\S]*?<\/footer>/gi, ' ')
      .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
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
  hydrationQueued = false,
) {
  return {
    hits,
    query,
    estimatedTotalHits: hits.length,
    processingTimeMs: 0,
    cached,
    indexedCount,
    skippedCount,
    hydrationQueued,
  }
}

function toSummaryHit(hit: LegalSearchHit): LegalFetchSearchHit {
  return {
    id: hit.id,
    title: hit.title,
    neutralCitation: hit.neutralCitation,
    court: hit.court,
    jurisdiction: hit.jurisdiction,
    dateDecided: hit.dateDecided,
    sourceType: hit.sourceType,
    sourceUrl: hit.sourceUrl,
  }
}

function readTag(xml: string, tag: string) {
  return xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1]
}

function readAlternateLink(xml: string) {
  return readLink(xml, (attributes) =>
    hasLinkRel(attributes, 'alternate') && !readLinkAttribute(attributes, 'type'),
  )
}

function readTypedLink(xml: string, type: string) {
  return readLink(xml, (attributes) =>
    hasLinkRel(attributes, 'alternate') &&
    readLinkAttribute(attributes, 'type')?.toLowerCase() === type,
  )
}

function readRelLink(xml: string, rel: string) {
  return readLink(xml, (attributes) => hasLinkRel(attributes, rel))
}

function readLink(xml: string, predicate: (attributes: string) => boolean) {
  const attributes = Array.from(xml.matchAll(/<link\b([^>]*?)\/?>/gi))
    .map((match) => match[1])
    .find(predicate)

  return attributes ? readLinkAttribute(attributes, 'href') : undefined
}

function hasLinkRel(attributes: string, rel: string) {
  return readLinkAttribute(attributes, 'rel')
    ?.split(/\s+/)
    .some((value) => value.toLowerCase() === rel.toLowerCase()) ?? false
}

function readLinkAttribute(attributes: string, name: string) {
  return attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'))?.[1]
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
  if (documentId.startsWith('d-')) {
    return null
  }

  const court = Array.from(supportedFindCaseLawCourts)
    .sort((left, right) => right.length - left.length)
    .find((supportedCourt) => documentId.startsWith(`${supportedCourt}-`))

  if (!court) return null

  const suffix = documentId.slice(court.length + 1)
  const segments = suffix.split('-').filter(Boolean)
  const yearIndex = segments.findIndex(
    (segment, index) => /^\d{4}$/.test(segment) && /^\d+$/.test(segments[index + 1] ?? ''),
  )

  if (yearIndex === -1) return null

  const nestedPath = segments.slice(0, yearIndex).join('/')
  const year = segments[yearIndex]
  const sequence = segments[yearIndex + 1]
  const courtPath = toFindCaseLawCourtParam(court)
  const prefix = nestedPath ? `${courtPath}/${nestedPath}` : courtPath

  return `/${prefix}/${year}/${sequence}`
}

function courtFromDocumentId(documentId: string) {
  return Array.from(supportedFindCaseLawCourts)
    .sort((left, right) => right.length - left.length)
    .find((court) => documentId.startsWith(`${court}-`)) ?? null
}

function courtFromFindCaseLawPath(uri: string | null) {
  if (!uri) return null

  const path = uri.replace(/^\/+/, '').toLowerCase()
  const match = Array.from(findCaseLawCourtByPath)
    .sort((left, right) => right[0].length - left[0].length)
    .find(([courtPath]) => path === courtPath || path.startsWith(`${courtPath}/`))

  return match?.[1] ?? null
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

function addFindCaseLawDateParams(
  url: URL,
  request: Pick<z.infer<typeof legalFetchRequestSchema>, 'dateFrom' | 'dateTo'>,
) {
  addFindCaseLawDateParam(url, 'from_date', request.dateFrom)
  addFindCaseLawDateParam(url, 'to_date', request.dateTo)
}

function addFindCaseLawDateParam(url: URL, prefix: 'from_date' | 'to_date', value?: string) {
  if (!value) return

  const [year, month, day] = value.split('-')
  url.searchParams.set(`${prefix}_0`, day)
  url.searchParams.set(`${prefix}_1`, month)
  url.searchParams.set(`${prefix}_2`, year)
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
