import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import { createClient, listDocumentIds } from '@obiter/search-client'

/**
 * Search parity reconciler: Postgres `legal_source_documents` is the record,
 * the Meilisearch product index is derived. Pages every non-withdrawn
 * document id from Postgres, lists every id in the index, and diffs both
 * directions. Read-only: it reports drift, it never writes.
 *
 * Exit non-zero on drift so CI or a cron wrapper can fail closed on it.
 */

const localMeilisearchHost = 'http://127.0.0.1:7700'
const localMeilisearchAdminKey = 'obiter-local-dev-key'
const localDatabaseUrl = 'postgres://obiter:obiter@localhost:5432/obiter'
const defaultIndexName = 'legal_authorities'
const parityPageSize = 1000

export interface ParityReport {
  index: string
  postgresCount: number
  indexCount: number
  missingFromIndex: string[]
  extraInIndex: string[]
}

/** Both-directions diff over sorted id sets. Pure so drift detection is
 * testable without a database or an engine. */
export function diffParity(
  postgresIds: string[],
  indexIds: string[],
): Pick<ParityReport, 'missingFromIndex' | 'extraInIndex'> {
  const indexSet = new Set(indexIds)
  const postgresSet = new Set(postgresIds)
  return {
    missingFromIndex: postgresIds.filter((id) => !indexSet.has(id)),
    extraInIndex: indexIds.filter((id) => !postgresSet.has(id)),
  }
}

export async function runParityCheck(deps: {
  pool: Pick<Pool, 'query'>
  listIndexIds: () => Promise<string[]>
  indexName: string
  pageSize?: number
}): Promise<ParityReport> {
  const pageSize = deps.pageSize ?? parityPageSize
  const postgresIds: string[] = []
  for (let offset = 0; ; offset += pageSize) {
    const page = await deps.pool.query<{ document_id: string }>(
      `select document_id from legal_source_documents
        where provider_json->>'withdrawn' is null
        order by document_id limit $1 offset $2`,
      [pageSize, offset],
    )
    postgresIds.push(...page.rows.map((row) => row.document_id))
    if (page.rows.length < pageSize) break
  }
  const indexIds = await deps.listIndexIds()
  const { missingFromIndex, extraInIndex } = diffParity(postgresIds, indexIds)
  return {
    index: deps.indexName,
    postgresCount: postgresIds.length,
    indexCount: indexIds.length,
    missingFromIndex,
    extraInIndex,
  }
}

function readFlag(name: string) {
  return process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
}

async function main() {
  const databaseUrl =
    readFlag('database-url') ?? process.env.DATABASE_URL ?? localDatabaseUrl
  const meilisearchHost =
    readFlag('host') ?? process.env.MEILISEARCH_HOST ?? localMeilisearchHost
  const meilisearchAdminApiKey =
    readFlag('admin-key') ??
    process.env.MEILISEARCH_ADMIN_API_KEY ??
    localMeilisearchAdminKey
  const indexName =
    readFlag('index') ?? process.env.LEGAL_AUTHORITIES_INDEX ?? defaultIndexName

  const pool = new Pool({ connectionString: databaseUrl })
  const indexClient = createClient(meilisearchHost, meilisearchAdminApiKey)
  try {
    const report = await runParityCheck({
      pool,
      listIndexIds: () => listDocumentIds(indexClient, indexName),
      indexName,
    })
    console.log(JSON.stringify(report, null, 2))
    if (report.missingFromIndex.length > 0 || report.extraInIndex.length > 0) {
      console.error(
        `Search parity drift: ${report.missingFromIndex.length} missing from index, ` +
          `${report.extraInIndex.length} extra in index.`,
      )
      process.exitCode = 1
    } else {
      console.info(
        `Search parity clean: ${report.postgresCount} Postgres rows, ${report.indexCount} indexed.`,
      )
    }
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Parity check failed',
    )
    process.exitCode = 1
  })
