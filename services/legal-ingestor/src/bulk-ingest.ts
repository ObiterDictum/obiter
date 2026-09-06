import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import {
  atomEntryToAuthoritySummary,
  createMojRateLimiter,
  documentIdFromUri,
  fetchMojAuthorityDetail,
  parseFindCaseLawAtom,
  toFindCaseLawCourtParam,
  type AtomEntry,
  type FindCaseLawEnv,
  type MojRateLimiter,
  type ProviderDocumentResult,
  type ProviderSourceMetadata,
} from '@obiter/legal-source-provider'
import { readLegalIngestorEnv } from './env'

/**
 * Bulk ingestion from Find Case Law into Postgres `legal_source_documents`
 * only. The Meilisearch product index stays derived: `pnpm
 * rebuild:search-index` reads these rows afterwards. This module never touches
 * Meilisearch, so there is exactly one writer to the derived index.
 *
 * Polite by construction: one sequential loop, a fixed gap between upstream
 * requests (~1.5-2/s, well under the published 1000 per rolling 5 minutes so
 * a shared office IP never gets blocked), the shared sliding-window limiter
 * as a backstop, and `retry-after` honoured on 429.
 *
 * Resumable: `legal_ingestor_progress` records the last completed atom page
 * per scope, and ingestion is idempotent on `content_hash`, so a re-run
 * skips already-stored documents without re-fetching their bodies.
 *
 * Size note: this stays one module (~600 lines, over the 500 ceiling) on
 * purpose. Catch-up, forward walk, progress flush and idempotency share one
 * report/flush state, and there is no second caller; splitting would scatter
 * that state across modules for no reuse.
 */

// Provenance recorded on every row before the campaign, because retrofitting
// it afterwards is harder. The serving-side acknowledgement, noindex handling
// and partial-coverage notice are follow-ups, not part of this writer.
export const licenceClass = 'tna-transactional-2026-07-15' as const
const licenceProvider = 'find-case-law'

// ~1.8 requests/s sequential: full scope (~39k requests) takes ~6h, well
// under the 1000-per-5-minute cap. Slow is the point; a blocked office IP
// costs more than a slow ingest.
export const settledRequestGapMs = 600
const maxAttemptsPerItem = 5
const maxRetryAfterMs = 5 * 60 * 1000

export interface IngestScope {
  court: string
  dateFrom?: string
  dateTo?: string
}

const ewhcDivisions = [
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
] as const

// Measured scope: UKSC, UKPC, both EWCA divisions complete; EWHC decided
// from 2020-01-01 only. Older EWHC output is lower-value for a trial and is
// backfilled later by moving one date parameter.
export const defaultScopes: IngestScope[] = [
  { court: 'uksc' },
  { court: 'ukpc' },
  { court: 'ewca-civ' },
  { court: 'ewca-crim' },
  ...ewhcDivisions.map((court): IngestScope => ({
    court,
    dateFrom: '2020-01-01',
  })),
]

export function buildScopeKey(scope: IngestScope) {
  return `${scope.court}|${scope.dateFrom ?? ''}|${scope.dateTo ?? ''}`
}

export type DocOutcome =
  | { status: 'stored'; documentId: string }
  | { status: 'skipped-unchanged'; documentId: string }
  | { status: 'skipped-no-fulltext'; documentId: string; reason: string }
  | { status: 'failed'; documentId: string; reason: string }

export interface ScopeReport {
  court: string
  scopeKey: string
  pagesCompleted: number
  stored: number
  skippedUnchanged: number
  skippedNoFulltext: number
  failed: number
  failures: Array<{ documentId: string; reason: string }>
}

export type Db = Pick<Pool, 'query'>

export interface IngestDeps {
  pool: Db
  baseUrl: string
  limiter: MojRateLimiter
  gapMs: number
  sleep: (ms: number) => Promise<void>
  fetchImpl: typeof fetch
  fetchDetail: (entry: AtomEntry) => Promise<ProviderDocumentResult>
}

export function createDeps(
  pool: Db,
  env: FindCaseLawEnv,
  rateLimit: number,
  gapMs: number,
  overrides?: Partial<Pick<IngestDeps, 'sleep' | 'fetchImpl' | 'fetchDetail'>>,
): IngestDeps {
  const limiter = createMojRateLimiter(rateLimit)
  const providerEnv: FindCaseLawEnv = {
    mojFindCaseLawBaseUrl: env.mojFindCaseLawBaseUrl,
  }
  return {
    pool,
    baseUrl: env.mojFindCaseLawBaseUrl,
    limiter,
    gapMs,
    sleep:
      overrides?.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    fetchImpl: overrides?.fetchImpl ?? fetch,
    fetchDetail:
      overrides?.fetchDetail ??
      ((entry) =>
        fetchMojAuthorityDetail(providerEnv, entry, limiter, {
          preferLegalDocMl: true,
        })),
  }
}

function retryAfterMs(value: string | number | null) {
  const seconds = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return 30_000
  return Math.min(seconds * 1000, maxRetryAfterMs)
}

/** Pacing plus the shared sliding-window limiter: never fire faster than the gap. */
async function takePolitely(deps: IngestDeps) {
  await deps.sleep(deps.gapMs)
  for (;;) {
    const taken = deps.limiter.take()
    if (taken.allowed) return
    await deps.sleep(retryAfterMs(taken.retryAfterSeconds) + deps.gapMs)
  }
}

export function buildAtomPageUrl(
  baseUrl: string,
  scope: IngestScope,
  page: number,
) {
  const url = new URL('/atom.xml', baseUrl)
  url.searchParams.set('court', toFindCaseLawCourtParam(scope.court))
  url.searchParams.set('page', String(page))
  return url
}

export async function fetchAtomPage(
  deps: IngestDeps,
  scope: IngestScope,
  page: number,
): Promise<AtomEntry[] | { error: string }> {
  for (let attempt = 1; attempt <= maxAttemptsPerItem; attempt += 1) {
    await takePolitely(deps)
    let response: Response
    try {
      response = await deps.fetchImpl(
        buildAtomPageUrl(deps.baseUrl, scope, page),
      )
    } catch (error) {
      if (attempt === maxAttemptsPerItem)
        return {
          error: error instanceof Error ? error.message : 'atom fetch failed',
        }
      continue
    }
    if (response.status === 429) {
      await deps.sleep(retryAfterMs(response.headers.get('retry-after')))
      continue
    }
    if (!response.ok)
      return { error: `atom page ${page} returned ${response.status}` }
    // Client-side date/court filtering; rel=last arithmetic is untrusted.
    return parseFindCaseLawAtom(await response.text(), {
      query: '',
      court: scope.court,
      dateFrom: scope.dateFrom,
      dateTo: scope.dateTo,
    })
  }
  return {
    error: `atom page ${page} rate limited after ${maxAttemptsPerItem} attempts`,
  }
}

function withProvenance(provider: ProviderSourceMetadata, baseUrl: string) {
  return {
    ...provider,
    provider: licenceProvider,
    licenceClass,
    acquiredAt: new Date().toISOString(),
    sourceUrl: new URL(provider.sourceUri, baseUrl).toString(),
  }
}

async function upsertDocument(
  pool: Db,
  documentId: string,
  summaryJson: string,
  documentJson: string,
  providerJson: string,
  provider: ProviderSourceMetadata,
) {
  await pool.query(
    `
      insert into legal_source_documents (
        document_id, summary_json, document_json, provider_json,
        content_hash, source_uri, xml_uri, pdf_uri, updated_at
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
      documentId,
      summaryJson,
      documentJson,
      providerJson,
      provider.contentHash,
      provider.sourceUri,
      provider.xmlUri,
      provider.pdfUri,
    ],
  )
}

async function upsertSummaryOnly(
  pool: Db,
  documentId: string,
  summaryJson: string,
  providerJson: string,
  provider: ProviderSourceMetadata,
) {
  // Same shape as the API source store: document_json is untouched, so a
  // summary-only conflict never wipes a stored body.
  await pool.query(
    `
      insert into legal_source_documents (
        document_id, summary_json, provider_json,
        content_hash, source_uri, xml_uri, pdf_uri, updated_at
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
      documentId,
      summaryJson,
      providerJson,
      provider.contentHash,
      provider.sourceUri,
      provider.xmlUri,
      provider.pdfUri,
    ],
  )
}

export async function ingestOne(
  deps: IngestDeps,
  entry: AtomEntry,
): Promise<DocOutcome> {
  const documentId = documentIdFromUri(entry.uri)
  const stored = await deps.pool.query<{ content_hash: string }>(
    'select content_hash from legal_source_documents where document_id = $1',
    [documentId],
  )
  if (stored.rows[0]?.content_hash === entry.contentHash) {
    return { status: 'skipped-unchanged', documentId }
  }

  for (let attempt = 1; attempt <= maxAttemptsPerItem; attempt += 1) {
    await takePolitely(deps)
    let result: ProviderDocumentResult
    try {
      result = await deps.fetchDetail(entry)
    } catch (error) {
      return {
        status: 'failed',
        documentId,
        reason: error instanceof Error ? error.message : 'detail fetch threw',
      }
    }
    if (result.status === 'rate_limited') {
      await deps.sleep(retryAfterMs(result.retryAfter))
      continue
    }
    if (result.status === 'unavailable') {
      return {
        status: 'failed',
        documentId,
        reason: 'provider unavailable (5xx)',
      }
    }
    if (result.status === 'ok') {
      const summary = atomEntryToAuthoritySummary(
        { mojFindCaseLawBaseUrl: deps.baseUrl },
        entry,
      )
      await upsertDocument(
        deps.pool,
        documentId,
        JSON.stringify(summary),
        JSON.stringify(result.document),
        JSON.stringify(withProvenance(result.provider, deps.baseUrl)),
        result.provider,
      )
      return { status: 'stored', documentId }
    }
    // Skipped: PDF-only or unparsable. Stored as a summary so the rebuild
    // still indexes it, but reported as skipped with the reason, never
    // silently dropped. minimum_availability stays full-text.
    const reason = !entry.xmlUri
      ? 'no full-text XML upstream (PDF only)'
      : 'judgment body unparsable from provider HTML/XML'
    const summary = atomEntryToAuthoritySummary(
      { mojFindCaseLawBaseUrl: deps.baseUrl },
      entry,
    )
    const provider = withProvenance(
      {
        documentUri: entry.uri,
        sourceUri: entry.sourceUri,
        xmlUri: entry.xmlUri,
        pdfUri: entry.pdfUri,
        contentHash: entry.contentHash,
        rawAtomEntry: entry.rawXml,
      },
      deps.baseUrl,
    )
    await upsertSummaryOnly(
      deps.pool,
      documentId,
      JSON.stringify(summary),
      JSON.stringify(provider),
      provider,
    )
    return { status: 'skipped-no-fulltext', documentId, reason }
  }
  return {
    status: 'failed',
    documentId,
    reason: `rate limited after ${maxAttemptsPerItem} attempts`,
  }
}

// TODO(withdrawals, follow-up): judgments get withdrawn, replaced or
// corrected upstream and nothing deletes today. Corrections land
// automatically via the content_hash re-poll path above; true withdrawals
// need a pass that re-fetches stored document_ids, and on upstream
// absence/404 marks provider_json.withdrawn with an audit log instead of
// deleting (soft-delete default), then removes the row from publication via
// the rebuild. Deferred, not forgotten.
export async function ingestScope(
  deps: IngestDeps,
  scope: IngestScope,
  limits: { maxPages?: number; maxDocs?: number } = {},
): Promise<ScopeReport> {
  const scopeKey = buildScopeKey(scope)
  const progress = await deps.pool.query<{ last_completed_page: number }>(
    'select last_completed_page from legal_ingestor_progress where scope_key = $1',
    [scopeKey],
  )
  const maxPages = limits.maxPages ?? 10_000
  const report: ScopeReport = {
    court: scope.court,
    scopeKey,
    pagesCompleted: 0,
    stored: 0,
    skippedUnchanged: 0,
    skippedNoFulltext: 0,
    failed: 0,
    failures: [],
  }
  let docsThisRun = 0
  // Counters already flushed to the progress table; each flush writes only
  // the delta since the previous one, so cumulative report totals are never
  // double-counted across pages.
  const flushed = {
    stored: 0,
    skippedUnchanged: 0,
    skippedNoFulltext: 0,
    failed: 0,
  }

  // One page of entries tallied into the report. Returns true when the
  // maxDocs cap stopped the run.
  const ingestEntries = async (entries: AtomEntry[]): Promise<boolean> => {
    for (const entry of entries) {
      if (limits.maxDocs !== undefined && docsThisRun >= limits.maxDocs)
        return true
      const outcome = await ingestOne(deps, entry).catch((error: unknown) => ({
        status: 'failed' as const,
        documentId: documentIdFromUri(entry.uri),
        reason: error instanceof Error ? error.message : 'ingest threw',
      }))
      if (outcome.status === 'stored') report.stored += 1
      else if (outcome.status === 'skipped-unchanged')
        report.skippedUnchanged += 1
      else if (outcome.status === 'skipped-no-fulltext')
        report.skippedNoFulltext += 1
      else {
        report.failed += 1
        report.failures.push({
          documentId: outcome.documentId,
          reason: outcome.reason,
        })
      }
      docsThisRun += 1
    }
    return false
  }

  const recordFailure = (documentId: string, reason: string) => {
    report.failed += 1
    report.failures.push({ documentId, reason })
  }

  const cursor = progress.rows[0]?.last_completed_page ?? 0
  // Catch-up: the feed is newest-first, so judgments published since the
  // last run land on page 1, ahead of the cursor. Re-poll pages 1..cursor
  // before continuing; the content_hash check skips stored bodies, so this
  // costs atom fetches plus one hash lookup per document. The cursor stays
  // put until the forward walk advances it.
  for (
    let catchUpPage = 1;
    catchUpPage <= Math.min(cursor, maxPages);
    catchUpPage += 1
  ) {
    const entries = await fetchAtomPage(deps, scope, catchUpPage)
    if (!Array.isArray(entries)) {
      recordFailure(`${scope.court}:page:${catchUpPage}`, entries.error)
      break
    }
    if (entries.length === 0) break
    if (await ingestEntries(entries)) {
      await recordProgress(deps, scope, scopeKey, cursor, report, flushed)
      return report
    }
    await recordProgress(deps, scope, scopeKey, cursor, report, flushed)
  }

  let page = cursor + 1

  for (; page <= maxPages; page += 1) {
    const entries = await fetchAtomPage(deps, scope, page)
    if (!Array.isArray(entries)) {
      recordFailure(`${scope.court}:page:${page}`, entries.error)
      break
    }
    if (entries.length === 0) break
    if (await ingestEntries(entries)) {
      await recordProgress(deps, scope, scopeKey, page - 1, report, flushed)
      return report
    }
    report.pagesCompleted += 1
    await recordProgress(deps, scope, scopeKey, page, report, flushed)
  }
  return report
}

async function recordProgress(
  deps: IngestDeps,
  scope: IngestScope,
  scopeKey: string,
  page: number,
  report: ScopeReport,
  flushed: {
    stored: number
    skippedUnchanged: number
    skippedNoFulltext: number
    failed: number
  },
) {
  const delta = {
    stored: report.stored - flushed.stored,
    skippedUnchanged: report.skippedUnchanged - flushed.skippedUnchanged,
    skippedNoFulltext: report.skippedNoFulltext - flushed.skippedNoFulltext,
    failed: report.failed - flushed.failed,
  }
  flushed.stored = report.stored
  flushed.skippedUnchanged = report.skippedUnchanged
  flushed.skippedNoFulltext = report.skippedNoFulltext
  flushed.failed = report.failed
  await deps.pool.query(
    `
      insert into legal_ingestor_progress (
        scope_key, court, date_from, date_to, last_completed_page,
        stored_count, skipped_unchanged_count, skipped_no_fulltext_count,
        failed_count, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      on conflict (scope_key) do update set
        last_completed_page = excluded.last_completed_page,
        stored_count = legal_ingestor_progress.stored_count + excluded.stored_count,
        skipped_unchanged_count = legal_ingestor_progress.skipped_unchanged_count + excluded.skipped_unchanged_count,
        skipped_no_fulltext_count = legal_ingestor_progress.skipped_no_fulltext_count + excluded.skipped_no_fulltext_count,
        failed_count = legal_ingestor_progress.failed_count + excluded.failed_count,
        updated_at = now()
    `,
    [
      scopeKey,
      scope.court,
      scope.dateFrom ?? null,
      scope.dateTo ?? null,
      page,
      delta.stored,
      delta.skippedUnchanged,
      delta.skippedNoFulltext,
      delta.failed,
    ],
  )
}

function readFlag(name: string) {
  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

function readScopes(): IngestScope[] {
  const courts = readFlag('courts') ?? readFlag('court')
  if (!courts) return defaultScopes
  const dateFrom = readFlag('from-date')
  const dateTo = readFlag('to-date')
  return courts.split(',').map((court) => ({
    court: court.trim().toLowerCase().replace(/\//g, '-'),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  }))
}

async function main() {
  const env = readLegalIngestorEnv()
  const pool = new Pool({ connectionString: env.databaseUrl })
  const deps = createDeps(
    pool,
    env,
    env.mojFindCaseLawRateLimit,
    Number(readFlag('gap-ms') ?? settledRequestGapMs),
  )
  const limits = {
    ...(readFlag('max-pages')
      ? { maxPages: Number(readFlag('max-pages')) }
      : {}),
    ...(readFlag('max-docs') ? { maxDocs: Number(readFlag('max-docs')) } : {}),
  }
  const reports: ScopeReport[] = []
  for (const scope of readScopes()) {
    const report = await ingestScope(deps, scope, limits)
    reports.push(report)
    console.info(JSON.stringify(report))
  }
  await pool.end()
  const failed = reports.reduce((sum, report) => sum + report.failed, 0)
  const stored = reports.reduce((sum, report) => sum + report.stored, 0)
  console.info(JSON.stringify({ scopes: reports.length, stored, failed }))
  if (failed > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Bulk ingest failed')
    process.exitCode = 1
  })
