import { Pool } from 'pg'
import { pathToFileURL } from 'node:url'
import { createClient, getIndexStatus } from '@obiter/search-client'
import {
  createLegislationIndex,
  indexLegislationProvisions,
  type LegislationProvisionDocument,
} from '@obiter/search-client'

/**
 * Rebuilds the legislation_provisions Meilisearch index from Postgres, which
 * is the system of record. Repeatable and idempotent: every run streams all
 * of legislation_provisions through a staging index and atomically swaps it
 * into place. Deliberately a separate script from rebuild-search-index.ts
 * rather than a flag on it: the two corpora have different settings,
 * different readiness counts, and a shared script would let one corpus's
 * failure modes move the other's numbers.
 *
 * Provisions flagged has_unapplied_effects ARE indexed (flag included): the
 * serving layer withholds their text, and the flag is what lets it do so
 * without a live call. Excluding them would make amended provisions
 * unfindable instead of honestly labelled.
 */

const readPageSize = 1000
const localMeilisearchHost = 'http://127.0.0.1:7700'
const localMeilisearchAdminKey = 'obiter-local-dev-key'
const localDatabaseUrl = 'postgres://obiter:obiter@localhost:5432/obiter'
const defaultIndexName = 'legislation_provisions'
const stagingIndexSuffix = '--rebuild'
const swapTaskTimeoutMs = 60_000

interface RebuildReport {
  index: string
  docsRead: number
  indexed: number
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
      process.env.LEGISLATION_PROVISIONS_INDEX ??
      defaultIndexName,
  }
}

interface ProvisionRow {
  id: string
  document_identity: string
  act_type: string
  year: number
  number: number
  title: string
  label: string
  label_path: string
  extent: string
  provision_text: string
  has_unapplied_effects: boolean
  source_url: string
}

async function main() {
  const config = readConfig()
  const stagingIndexName = `${config.indexName}${stagingIndexSuffix}`
  const pool = new Pool({ connectionString: config.databaseUrl })
  const admin = createClient(
    config.meilisearchHost,
    config.meilisearchAdminApiKey,
  )
  const report: RebuildReport = {
    index: config.indexName,
    docsRead: 0,
    indexed: 0,
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

  try {
    await admin.deleteIndexIfExists(stagingIndexName)
    await createLegislationIndex(admin, stagingIndexName)

    let lastId = ''
    for (;;) {
      const page = await pool.query<ProvisionRow>(
        // Container rows (Part, Chapter, Schedule, crossheading) are
        // headings with no searchable body: provisions only reach the index.
        `select p.id, p.document_identity,
                d.act_type, d.year, d.number, d.title,
                p.label, p.label_path, p.extent, p.provision_text,
                p.has_unapplied_effects, d.source_url
           from legislation_provisions p
           join legislation_documents d on d.identity = p.document_identity
          where p.id > $1
            and p.kind in ('P1', 'P2', 'P3', 'P4', 'P5')
          order by p.id limit $2`,
        [lastId, readPageSize],
      )
      if (page.rows.length === 0) break
      report.docsRead += page.rows.length
      const documents: LegislationProvisionDocument[] = page.rows.map((row) => {
        const provisionRef = `${row.document_identity}/${row.label_path}`
        return {
          // Engine ids reject slashes; the full path stays queryable in
          // provisionRef while the hyphen form is the primary key.
          id: provisionRef.replaceAll('/', '-'),
          provisionRef,
          documentIdentity: row.document_identity,
          actType: row.act_type,
          year: row.year,
          number: row.number,
          title: row.title,
          label: row.label,
          labelPath: row.label_path,
          extent: row.extent,
          text: row.provision_text,
          hasUnappliedEffects: row.has_unapplied_effects,
          sourceUrl: row.source_url,
        }
      })
      const indexed = await indexLegislationProvisions(
        admin,
        stagingIndexName,
        documents,
      )
      if (indexed.failedCount > 0) {
        const cleanupFailure = await removeStaging()
        fail(
          `Rebuild aborted during staging: ${indexed.errors.map((error) => error.message).join('; ')} Product index untouched.` +
            (cleanupFailure === null
              ? ''
              : ` Staging cleanup failed (${cleanupFailure}); the next run resets staging before writing.`),
        )
      }
      report.indexed += indexed.indexedCount
      lastId = page.rows[page.rows.length - 1]?.id ?? lastId
    }

    await createLegislationIndex(admin, config.indexName)
    try {
      await admin
        .swapIndexes([{ indexes: [stagingIndexName, config.indexName] }])
        .waitTask({ timeout: swapTaskTimeoutMs, interval: 100 })
    } catch (error) {
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
      `Rebuilt ${config.indexName}: ${report.indexed} provisions indexed, readiness ready.`,
    )
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Rebuild failed')
    process.exit(1)
  })
