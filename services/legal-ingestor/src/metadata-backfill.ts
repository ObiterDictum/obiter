import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import {
  createMojRateLimiter,
  fetchPublishedCaseLawMetadata,
  type FindCaseLawEnv,
  type MojRateLimiter,
  type PublishedMetadataResult,
  type ProviderFetch,
} from '@obiter/legal-source-provider'
import { readLegalIngestorEnv } from './env'
import { settledRequestGapMs, type Db } from './bulk-ingest'

const maxAttemptsPerRow = 5
const maxRetryAfterMs = 5 * 60 * 1000

// Legal: Find Case Law's Open Justice Licence excludes computational analysis; the bench and summary come only from published metadata, never judgment prose.
export interface MetadataBackfillReport {
  dryRun: boolean
  limit: number
  pending: number
  documentIds: string[]
  fetched: number
  judgesFound: number
  summaryFound: number
  none: number
  failed: Array<{ documentId: string; reason: string }>
  remaining: number
}

export interface MetadataBackfillDeps {
  pool: Db
  env: FindCaseLawEnv
  limiter: MojRateLimiter
  gapMs: number
  sleep: (ms: number) => Promise<void>
  fetchImpl: ProviderFetch
}

export function createMetadataBackfillDeps(
  pool: Db,
  env: FindCaseLawEnv,
  rateLimit: number,
  overrides?: Partial<
    Pick<MetadataBackfillDeps, 'gapMs' | 'sleep' | 'fetchImpl'>
  >,
): MetadataBackfillDeps {
  return {
    pool,
    env,
    limiter: createMojRateLimiter(rateLimit),
    gapMs: overrides?.gapMs ?? settledRequestGapMs,
    sleep:
      overrides?.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    fetchImpl: overrides?.fetchImpl ?? fetch,
  }
}

interface PendingRow {
  document_id: string
  court: string
  xml_uri: string | null
  source_uri: string
}

function retryAfterMs(value: string | null) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) return 30_000
  return Math.min(seconds * 1000, maxRetryAfterMs)
}

function pacedFetch(deps: MetadataBackfillDeps): ProviderFetch {
  return async (input, init) => {
    await deps.sleep(deps.gapMs)
    return deps.fetchImpl(input, init)
  }
}

async function readOne(
  deps: MetadataBackfillDeps,
  row: PendingRow,
): Promise<PublishedMetadataResult> {
  const fetchImpl = pacedFetch(deps)
  for (let attempt = 1; attempt <= maxAttemptsPerRow; attempt += 1) {
    const result = await fetchPublishedCaseLawMetadata(
      deps.env,
      {
        court: row.court,
        xmlUri: row.xml_uri,
        sourceUri: row.source_uri,
      },
      deps.limiter,
      { fetchImpl },
    )
    if (result.status !== 'rate_limited') return result
    await deps.sleep(retryAfterMs(result.retryAfter))
  }

  return { status: 'rate_limited', retryAfter: null }
}

export async function backfillPublishedMetadata(
  deps: MetadataBackfillDeps,
  options: { limit: number; dryRun?: boolean },
): Promise<MetadataBackfillReport> {
  const pending = await deps.pool.query<{ count: string }>(
    'select count(*)::text as count from legal_source_documents where metadata_fetched_at is null',
  )
  const rows = await deps.pool.query<PendingRow>(
    `
      select document_id, summary_json->>'court' as court, xml_uri, source_uri
      from legal_source_documents
      where metadata_fetched_at is null
      order by summary_json->>'dateDecided' desc nulls last, document_id
      limit $1
    `,
    [options.limit],
  )

  const report: MetadataBackfillReport = {
    dryRun: options.dryRun === true,
    limit: options.limit,
    pending: Number(pending.rows[0]?.count ?? 0),
    documentIds: rows.rows.map((row) => row.document_id),
    fetched: 0,
    judgesFound: 0,
    summaryFound: 0,
    none: 0,
    failed: [],
    remaining: Number(pending.rows[0]?.count ?? 0),
  }
  if (report.dryRun) return report

  for (const row of rows.rows) {
    const result = await readOne(deps, row)
    if (result.status === 'ok') {
      const { judges, summary } = result.metadata
      await deps.pool.query(
        `
          update legal_source_documents
          set judges = $2::jsonb,
              summary = $3::jsonb,
              metadata_fetched_at = now()
          where document_id = $1
        `,
        [
          row.document_id,
          judges.length > 0 ? JSON.stringify(judges) : null,
          summary ? JSON.stringify(summary) : null,
        ],
      )
      report.fetched += 1
      if (judges.length > 0) report.judgesFound += 1
      if (summary) report.summaryFound += 1
      if (judges.length === 0 && !summary) report.none += 1
      report.remaining -= 1
      continue
    }

    if (result.status === 'skipped' && result.reason === 'unparsable') {
      await deps.pool.query(
        `
          update legal_source_documents
          set judges = null, summary = null, metadata_fetched_at = now()
          where document_id = $1
        `,
        [row.document_id],
      )
      report.fetched += 1
      report.none += 1
      report.remaining -= 1
      continue
    }

    report.failed.push({
      documentId: row.document_id,
      reason:
        result.status === 'skipped'
          ? `provider ${result.reason}`
          : result.status === 'rate_limited'
            ? 'rate limited after retries'
            : 'provider unavailable (5xx)',
    })
  }

  return report
}

function readFlag(name: string) {
  return process.argv
    .find((arg) => arg.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

async function main() {
  const limit = Number(readFlag('limit'))
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(
      'metadata backfill needs an explicit bound: --limit=<rows> (the full re-crawl is a separate run).',
    )
  }
  const env = readLegalIngestorEnv()
  const pool = new Pool({ connectionString: env.databaseUrl })
  const deps = createMetadataBackfillDeps(
    pool,
    env,
    env.mojFindCaseLawRateLimit,
    readFlag('gap-ms') ? { gapMs: Number(readFlag('gap-ms')) } : undefined,
  )
  const report = await backfillPublishedMetadata(deps, {
    limit,
    dryRun: process.argv.includes('--dry-run'),
  })
  await pool.end()
  console.info(JSON.stringify(report))
  if (report.failed.length > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Metadata backfill failed',
    )
    process.exitCode = 1
  })
