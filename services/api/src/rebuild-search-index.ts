import { Pool, type PoolClient } from 'pg'
import { pathToFileURL } from 'node:url'
import { LegalAuthoritySchema } from '@obiter/legal-schema'
import {
  createClient,
  createIndex,
  getIndexStatus,
  indexDocuments,
} from '@obiter/search-client'

const readPageSize = 500

const localMeilisearchHost = 'http://127.0.0.1:7700'
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
    await admin.deleteIndexIfExists(stagingIndexName)
    await createIndex(admin, stagingIndexName)

    await snapshot.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    snapshotOpen = true
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
      await rollbackSnapshot()
      const cleanupFailure = await removeStaging()
      fail(
        `Rebuild aborted during staging: ${reason} Product index untouched.` +
          (cleanupFailure === null
            ? ''
            : ` Staging cleanup failed (${cleanupFailure}); the next run resets staging before writing.`),
      )
    }

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
    await rollbackSnapshot()
    snapshot?.release()
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Rebuild failed')
    process.exit(1)
  })
