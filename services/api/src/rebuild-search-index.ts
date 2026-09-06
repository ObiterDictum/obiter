import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import { LegalAuthoritySchema } from '@obiter/legal-schema'
import {
  createClient,
  createIndex,
  getIndexStatus,
  indexDocuments,
} from '@obiter/search-client'

/**
 * Rebuilds the product Meilisearch index from Postgres, which is the system
 * of record. Repeatable and idempotent: every run reads all of
 * legal_source_documents, builds a staging index, and atomically swaps it
 * into place. Not a migration — it derives the index from current rows.
 *
 * Rows with only summary_json (no document_json) ARE indexed, as summaries.
 * Paragraphs are optional in the authority schema, so a summary-only row
 * still answers exact citation, id and title lookups; only the body-text
 * match tiers cannot fire for it. Dropping those rows would silently narrow
 * the derived index below what Postgres holds, which is worse than a
 * summary-only hit. They are counted separately as indexedFromSummaryOnly.
 *
 * Failure leaves no half-rebuilt product index behind. Validation happens
 * entirely before anything is written: any invalid row aborts the run with
 * the product index untouched. Indexing happens on the staging index; if it
 * fails the staging index is deleted and the product index keeps serving the
 * previous build. The run verifies readiness afterwards and exits non-zero
 * unless the product index reports ready with the expected document count,
 * so readiness can never call a partial rebuild ready.
 */

const localMeilisearchHost = 'http://127.0.0.1:7700'
// The single local key. Compose, CI, ci-local.sh and the benchmark all use
// this value; production sets MEILISEARCH_ADMIN_API_KEY explicitly.
const localMeilisearchAdminKey = 'obiter-local-dev-key'
const localDatabaseUrl = 'postgres://obiter:obiter@localhost:5432/obiter'
const defaultIndexName = 'legal_authorities'
const stagingIndexSuffix = '--rebuild'
const swapTaskTimeoutMs = 60_000

interface SkippedRow {
  documentId: string
  reason: string
}

interface RebuildReport {
  index: string
  docsRead: number
  excludedWithdrawn: number
  indexed: number
  indexedFromSummaryOnly: number
  skipped: SkippedRow[]
  documentCount: number | null
}

function readFlag(name: string) {
  return process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

function readConfig() {
  return {
    databaseUrl:
      readFlag('database-url') ?? process.env.DATABASE_URL ?? localDatabaseUrl,
    meilisearchHost:
      readFlag('host') ?? process.env.MEILISEARCH_HOST ?? localMeilisearchHost,
    meilisearchAdminApiKey:
      readFlag('admin-key') ??
      process.env.MEILISEARCH_ADMIN_API_KEY ??
      localMeilisearchAdminKey,
    indexName:
      readFlag('index') ??
      process.env.LEGAL_AUTHORITIES_INDEX ??
      defaultIndexName,
  }
}

async function main() {
  const config = readConfig()
  const stagingIndexName = `${config.indexName}${stagingIndexSuffix}`
  const databaseTarget = new URL(config.databaseUrl)
  console.info(
    `Rebuilding Meilisearch index ${config.indexName} on ${config.meilisearchHost} ` +
      `from database ${databaseTarget.pathname.replace(/^\//, '')} on host ${databaseTarget.host}...`,
  )

  const pool = new Pool({ connectionString: config.databaseUrl })
  const admin = createClient(
    config.meilisearchHost,
    config.meilisearchAdminApiKey,
  )
  // ponytail: no try/finally around pool.end; a throw below exits non-zero
  // with the pool still open, and the process ending releases it.
  // Withdrawn rows are excluded from the derived index: Postgres is the
  // record, so the mark survives there and the product index simply stops
  // serving the document. Counted separately so the report shows what was
  // left out and why, rather than silently narrowing the index.
  const rows = await pool.query<{
    document_id: string
    summary_json: unknown
    document_json: unknown | null
  }>(
    `select document_id, summary_json, document_json from legal_source_documents
      where provider_json->>'withdrawn' is null order by document_id`,
  )
  const withdrawn = await pool.query<{ count: string }>(
    `select count(*) as count from legal_source_documents
      where provider_json->>'withdrawn' is not null`,
  )
  await pool.end()

  const documents = []
  const skipped: SkippedRow[] = []
  let indexedFromSummaryOnly = 0
  for (const row of rows.rows) {
    const candidate = row.document_json ?? row.summary_json
    const parsed = LegalAuthoritySchema.safeParse(candidate)
    if (!parsed.success) {
      skipped.push({
        documentId: row.document_id,
        reason: parsed.error.issues.map((issue) => issue.message).join('; '),
      })
      continue
    }
    if (row.document_json === null) indexedFromSummaryOnly += 1
    documents.push(parsed.data)
  }

  const report: RebuildReport = {
    index: config.indexName,
    docsRead: rows.rows.length,
    excludedWithdrawn: Number(withdrawn.rows[0]?.count ?? 0),
    indexed: 0,
    indexedFromSummaryOnly,
    skipped,
    documentCount: null,
  }
  const fail = (message: string): never => {
    console.log(JSON.stringify(report, null, 2))
    throw new Error(message)
  }

  if (skipped.length > 0) {
    fail(
      `Rebuild aborted: ${skipped.length} of ${report.docsRead} rows failed validation. Product index untouched.`,
    )
  }

  // Idempotent staging: a crashed run may have left the staging index behind.
  await admin.deleteIndexIfExists(stagingIndexName)
  await createIndex(admin, stagingIndexName)
  try {
    const indexed = await indexDocuments(admin, stagingIndexName, documents)
    if (indexed.failedCount > 0) {
      throw new Error(indexed.errors.map((error) => error.message).join('; '))
    }
    report.indexed = indexed.indexedCount
  } catch (error) {
    await admin.deleteIndexIfExists(stagingIndexName)
    const reason = error instanceof Error ? error.message : String(error)
    fail(`Rebuild aborted during staging: ${reason} Product index untouched.`)
  }

  // createIndex tolerates an existing index, so this also covers the first
  // rebuild on a fresh instance where the product index does not exist yet.
  await createIndex(admin, config.indexName)
  try {
    const swapPair: [string, string] = [stagingIndexName, config.indexName]
    await admin
      .swapIndexes([{ indexes: swapPair }])
      .waitTask({ timeout: swapTaskTimeoutMs, interval: 100 })
  } catch (error) {
    await admin.deleteIndexIfExists(stagingIndexName)
    const reason = error instanceof Error ? error.message : String(error)
    fail(`Rebuild aborted during swap: ${reason} Product index untouched.`)
  }
  await admin.deleteIndexIfExists(stagingIndexName)

  const state = await getIndexStatus(admin, config.indexName)
  report.documentCount = state.documentCount
  console.log(JSON.stringify(report, null, 2))
  if (state.status !== 'ready' || state.documentCount !== report.indexed) {
    throw new Error(
      `Rebuild finished but index ${config.indexName} reports ${state.status} ` +
        `(count ${String(state.documentCount)}, expected ${report.indexed}).`,
    )
  }
  console.info(
    `Rebuilt ${config.indexName}: ${report.indexed} documents indexed ` +
      `(${indexedFromSummaryOnly} from summaries only, ${report.excludedWithdrawn} withdrawn excluded), readiness ready.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Rebuild failed')
    process.exitCode = 1
  })
