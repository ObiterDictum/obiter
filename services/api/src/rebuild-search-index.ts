import { Pool, type PoolClient } from 'pg'
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
 * of record. Repeatable and idempotent: every run streams all of
 * legal_source_documents through a staging index and atomically swaps it
 * into place. Not a migration — it derives the index from current rows.
 *
 * Rows with only summary_json (no document_json) ARE indexed, as summaries.
 * Paragraphs are optional in the authority schema, so a summary-only row
 * still answers exact citation, id and title lookups; only the body-text
 * match tiers cannot fire for it. Dropping those rows would silently narrow
 * the derived index below what Postgres holds, which is worse than a
 * summary-only hit. They are counted separately as indexedFromSummaryOnly.
 *
 * Memory is bounded by one read page, not one corpus. Rows are keyset-paged
 * from Postgres on document_id (page size below), validated per page, and
 * each page is partitioned by measured JSON bytes, sent to staging, and
 * released before the next page is read. Peak memory is one page plus one
 * HTTP payload batch; the whole corpus is never materialised.
 *
 * The whole paged read runs inside a single REPEATABLE READ transaction on
 * one dedicated client, so every page sees the same snapshot. document_id
 * is a hash, not a sequence, so without this a row inserted below the
 * cursor mid-rebuild would be missed entirely and the index would silently
 * end up short. The transaction commits as soon as the last page is read
 * and never spans the swap; every abort path rolls it back before staging
 * cleanup, because a leaked open transaction blocks vacuum.
 *
 * Fail-before-write is per page, not whole-corpus: each page is validated as
 * it is read and the first bad row aborts the run with the product index
 * untouched. Earlier pages may already sit on the staging index at that
 * point, so an abort deletes the staging index. The product index is only
 * ever touched by the atomic swap, which runs after every batch succeeded.
 * A whole-corpus validation pass before any write would double the read for
 * no extra product safety, so the run does not do one.
 *
 * Failure leaves no half-rebuilt product index behind. Indexing happens on
 * the staging index; if it fails the staging index is deleted and the
 * product index keeps serving the previous build. The run verifies readiness
 * afterwards and exits non-zero unless the product index reports ready with
 * the expected document count, so readiness can never call a partial rebuild
 * ready.
 */

// 500 rows keeps a page plus one 80 MB payload batch well under the default
// heap even for the largest judgments measured (~1 MB stored), while keeping
// the page count (76 for 37,934 rows) low enough that keyset round trips do
// not dominate the run.
const readPageSize = 500

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
  const report: RebuildReport = {
    index: config.indexName,
    docsRead: 0,
    excludedWithdrawn: 0,
    indexed: 0,
    indexedFromSummaryOnly: 0,
    skipped: [],
    documentCount: null,
  }
  const fail = (message: string): never => {
    console.log(JSON.stringify(report, null, 2))
    throw new Error(message)
  }
  // Staging cleanup must never mask the error that caused it. When the
  // staging failure is the engine itself going away, the delete below
  // fails too; the run still reports the original reason and the product
  // guarantee, and notes the orphan. The next run deletes stale staging
  // before writing anything, so an orphan can never leak into a build.
  const removeStaging = async (): Promise<string | null> => {
    try {
      await admin.deleteIndexIfExists(stagingIndexName)
      return null
    } catch (cleanupError) {
      return cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError)
    }
  }

  // The paged read below runs in a single REPEATABLE READ transaction on
  // one dedicated client, so every page sees the same snapshot even if
  // rows are inserted concurrently. The client is released on every exit
  // path (including the abort paths, which roll back before staging
  // cleanup); a leaked open transaction blocks vacuum, which is worse than
  // the missed-row problem being fixed. Counts run on the same client so
  // the expected total matches the snapshot the pages read.
  // pool.connect sits inside the try so a connect failure still reaches
  // pool.end in the finally.
  let snapshot: PoolClient | null = null
  let snapshotOpen = false
  const rollbackSnapshot = async (): Promise<void> => {
    if (!snapshotOpen || snapshot === null) return
    snapshotOpen = false
    try {
      await snapshot.query('ROLLBACK')
    } catch {
      // The original error matters; a rollback failure only affects cleanup.
    }
  }
  try {
    snapshot = await pool.connect()
    // Idempotent staging: a crashed run may have left the staging index behind.
    // Runs before BEGIN so the snapshot is held only for the read itself.
    await admin.deleteIndexIfExists(stagingIndexName)
    await createIndex(admin, stagingIndexName)

    await snapshot.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    snapshotOpen = true
    // Withdrawn rows are excluded from the derived index: Postgres is the
    // record, so the mark survives there and the product index simply stops
    // serving the document. Counted separately so the report shows what was
    // left out and why, rather than silently narrowing the index.
    // Sequential queries: one client runs one query at a time, and both
    // must see the same snapshot as the pages below.
    const expected = await snapshot.query<{ count: string }>(
      `select count(*) as count from legal_source_documents
          where provider_json->>'withdrawn' is null`,
    )
    const withdrawn = await snapshot.query<{ count: string }>(
      `select count(*) as count from legal_source_documents
          where provider_json->>'withdrawn' is not null`,
    )
    const totalDocuments = Number(expected.rows[0]?.count ?? 0)
    report.excludedWithdrawn = Number(withdrawn.rows[0]?.count ?? 0)
    console.info(
      `Streaming ${totalDocuments} rows from Postgres in pages of ${readPageSize} ` +
        `(${report.excludedWithdrawn} withdrawn excluded).`,
    )

    try {
      // Keyset on document_id: stable under concurrent inserts elsewhere in
      // the keyspace and free of offset drift within the snapshot.
      // document_id is unique, so `>` never skips or repeats a row.
      let lastDocumentId = ''
      let pageNumber = 0
      let batchNumber = 0
      for (;;) {
        const page = await snapshot.query<{
          document_id: string
          summary_json: unknown
          document_json: unknown | null
        }>(
          `select document_id, summary_json, document_json from legal_source_documents
            where provider_json->>'withdrawn' is null and document_id > $1
            order by document_id limit $2`,
          [lastDocumentId, readPageSize],
        )
        if (page.rows.length === 0) break
        pageNumber += 1
        report.docsRead += page.rows.length

        const documents = []
        for (const row of page.rows) {
          const candidate = row.document_json ?? row.summary_json
          const parsed = LegalAuthoritySchema.safeParse(candidate)
          if (!parsed.success) {
            report.skipped.push({
              documentId: row.document_id,
              reason: parsed.error.issues
                .map((issue) => issue.message)
                .join('; '),
            })
            continue
          }
          if (row.document_json === null) report.indexedFromSummaryOnly += 1
          documents.push(parsed.data)
        }

        if (report.skipped.length > 0) {
          throw new Error(
            `Validation failed on page ${pageNumber}: ` +
              `${report.skipped.length} of ${report.docsRead} rows failed validation.`,
          )
        }

        // indexDocuments partitions this page by measured payload bytes and
        // sends it batch by batch; the page array is released before the
        // next page is read, so peak memory stays at one page plus one batch.
        const indexed = await indexDocuments(
          admin,
          stagingIndexName,
          documents,
          {
            onProgress: ({ batchCount, batchDocumentCount }) => {
              batchNumber += 1
              console.info(
                `Indexing staging batch ${batchNumber} ` +
                  `(page ${pageNumber}, ${batchDocumentCount} documents, ` +
                  `${report.indexed} of ${totalDocuments} indexed so far, ` +
                  `${batchCount} batches in page).`,
              )
            },
          },
        )
        if (indexed.failedCount > 0) {
          throw new Error(
            indexed.errors.map((error) => error.message).join('; '),
          )
        }
        report.indexed += indexed.indexedCount
        lastDocumentId =
          page.rows[page.rows.length - 1]?.document_id ?? lastDocumentId
      }

      console.info(
        `Read ${report.docsRead} rows from Postgres; ` +
          `${report.indexed} valid authorities indexed ` +
          `(${report.indexedFromSummaryOnly} summary-only, ` +
          `${report.excludedWithdrawn} withdrawn excluded).`,
      )
      await snapshot.query('COMMIT')
      snapshotOpen = false
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      // Roll back before touching Meilisearch: the snapshot must not stay
      // open across cleanup, and fail() below throws, so this catch is the
      // only place that can release it on the abort path.
      await rollbackSnapshot()
      const cleanupFailure = await removeStaging()
      fail(
        `Rebuild aborted during staging: ${reason} Product index untouched.` +
          (cleanupFailure === null
            ? ''
            : ` Staging cleanup failed (${cleanupFailure}); the next run resets staging before writing.`),
      )
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
      const reason = error instanceof Error ? error.message : String(error)
      const cleanupFailure = await removeStaging()
      fail(
        `Rebuild aborted during swap: ${reason} Product index untouched.` +
          (cleanupFailure === null
            ? ''
            : ` Staging cleanup failed (${cleanupFailure}); the next run resets staging before writing.`),
      )
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
        `(${report.indexedFromSummaryOnly} from summaries only, ${report.excludedWithdrawn} withdrawn excluded), readiness ready.`,
    )
  } finally {
    // Covers connect failure (snapshot null, no-op rollback), BEGIN
    // failure, count-query failure, and any throw between BEGIN and COMMIT
    // that the inner catch did not already roll back. No-op after a
    // successful COMMIT. pool.end runs after the client is back in the
    // pool so an open snapshot can never outlive the run.
    await rollbackSnapshot()
    snapshot?.release()
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Rebuild failed')
    // Exit explicitly rather than setting exitCode: a waitTask that throws
    // (the abort path above) leaks its timeout timer inside meilisearch-js
    // 0.51.0, which only clears it on success. The ref'd timer holds the
    // event loop for the full indexing timeout, so the run would report its
    // failure and then hang for 30 minutes instead of exiting non-zero.
    // Every cleanup this run owns (pool.end, staging delete attempt) has
    // already run by this point, so nothing is skipped.
    process.exit(1)
  })
