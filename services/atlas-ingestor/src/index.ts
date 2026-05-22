import { atlasAuthoritiesSchema } from '@ormont/legal-schema'
import { createClient, createIndex, indexDocuments } from '@ormont/search-client'
import { pathToFileURL } from 'node:url'
import { readAtlasIngestorEnv, type AtlasIngestorEnv } from './env'
import { sampleJudgments } from './fixtures/sample-judgments'

export interface BoundedIndexingReport {
  indexedCount: number
  failedCount: number
  errors: Array<{ recordId: string | null; message: string }>
}

export async function runBoundedSampleIndexing(
  env: AtlasIngestorEnv,
): Promise<BoundedIndexingReport> {
  const parsed = atlasAuthoritiesSchema.safeParse(sampleJudgments)

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

  await createIndex(client, env.atlasAuthoritiesIndex)

  return indexDocuments(client, env.atlasAuthoritiesIndex, parsed.data)
}

async function main() {
  const report = await runBoundedSampleIndexing(readAtlasIngestorEnv())

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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
