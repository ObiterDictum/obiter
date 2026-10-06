import { legalAuthoritiesSchema } from '@obiter/legal-schema'
import {
  createClient,
  createIndex,
  indexDocuments,
} from '@obiter/search-client'
import { pathToFileURL } from 'node:url'
import { readLegalIngestorEnv, type LegalIngestorEnv } from './env'
import { sampleJudgments } from './fixtures/sample-judgments'

export interface BoundedIndexingReport {
  indexedCount: number
  failedCount: number
  errors: Array<{ recordId: string | null; message: string }>
}

// Product index owned by the rebuild path. The fixture seeder writes its
// own index and refuses this one, so dev seeding can never narrow or widen
// what product search serves.
const productLegalAuthoritiesIndex = 'legal_authorities'

export async function runBoundedSampleIndexing(
  env: LegalIngestorEnv,
): Promise<BoundedIndexingReport> {
  if (env.legalAuthoritiesIndex === productLegalAuthoritiesIndex) {
    throw new Error(
      `Refusing to seed fixtures into product index ${productLegalAuthoritiesIndex}, which the rebuild owns.`,
    )
  }
  const parsed = legalAuthoritiesSchema.safeParse(sampleJudgments)

  if (!parsed.success) {
    return {
      indexedCount: 0,
      failedCount: sampleJudgments.length,
      errors: parsed.error.issues.map((issue) => ({
        recordId: null,
        message: issue.message,
      })),
    }
  }

  const client = createClient(env.meilisearchHost, env.meilisearchAdminApiKey)

  await createIndex(client, env.legalAuthoritiesIndex)

  return indexDocuments(client, env.legalAuthoritiesIndex, parsed.data)
}

async function main() {
  const report = await runBoundedSampleIndexing(readLegalIngestorEnv())

  console.log(
    JSON.stringify(
      {
        indexedCount: report.indexedCount,
        failedCount: report.failedCount,
        errors: report.errors,
      },
      null,
      2,
    ),
  )

  if (report.failedCount > 0) {
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
