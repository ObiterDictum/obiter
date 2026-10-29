import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { legislationRelevanceBaseline } from './baseline'
import { legislationRelevanceCases, legislationRelevanceTopK } from './cases'
import {
  assertReadyLegislationIndex,
  assertRunnerProvenance,
  defaultApiBase,
  defaultDatabaseUrl,
  defaultLegislationIndexName,
  legislationReportProvenance,
  readApiProvenance,
  readLiveIndexSettings,
  readReadiness,
  readRunnerProvenance,
  runCases,
  verifyLegislationExpectations,
} from './corpus'
import {
  aggregateMetrics,
  baselineFromResults,
  regressionFailures,
  type CaseResult,
} from './metrics'

function readMeiliConfig() {
  return {
    host: process.env.MEILISEARCH_HOST ?? 'http://127.0.0.1:7700',
    apiKey:
      process.env.MEILISEARCH_SEARCH_API_KEY ??
      process.env.SEARCH_BENCHMARK_API_KEY ??
      'obiter-local-dev-key',
  }
}

function metricsByCategory(results: CaseResult[]) {
  const categories = [
    ...new Set(legislationRelevanceCases.map(({ category }) => category)),
  ]
  return Object.fromEntries(
    categories.map((category) => [
      category,
      aggregateMetrics(
        results.filter((result) => result.category === category),
      ),
    ]),
  )
}

async function writeReport(report: unknown) {
  const reportPath = process.env.LEGISLATION_RELEVANCE_REPORT_PATH
  if (!reportPath) return
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function main() {
  if (
    legislationRelevanceCases.length !==
    legislationRelevanceBaseline.expectedCaseCount
  ) {
    throw new Error(
      `Legislation relevance suite defines ${legislationRelevanceCases.length} cases; expected ${legislationRelevanceBaseline.expectedCaseCount}.`,
    )
  }

  const apiBase = defaultApiBase()
  const indexName = defaultLegislationIndexName()
  const databaseUrl = defaultDatabaseUrl()

  const runnerProvenance = await readRunnerProvenance()
  assertRunnerProvenance(runnerProvenance)

  const readiness = await readReadiness(apiBase)
  const index = assertReadyLegislationIndex(
    readiness,
    indexName,
    legislationRelevanceBaseline.expectedIndexDocumentCount,
  )
  await verifyLegislationExpectations(databaseUrl)

  const apiProvenance = await readApiProvenance(apiBase)
  console.error(
    `Runner ${runnerProvenance.checkoutRoot ?? 'provenance not reported'} @ ${runnerProvenance.commitSha ?? 'unknown'}; measuring API ${apiBase} (${apiProvenance.checkoutRoot ?? 'provenance not reported'} @ ${apiProvenance.commitSha ?? 'unknown'}) against ${indexName}.`,
  )

  const liveIndexSettings = await readLiveIndexSettings(
    readMeiliConfig().host,
    readMeiliConfig().apiKey,
    indexName,
  )

  const { results, searchParameters } = await runCases(apiBase)
  if (!searchParameters) {
    throw new Error(
      'The measured server reported no legislation search parameters (diagnostics.legislationSearchParameters). Refusing to record conditions this run never observed; point LEGISLATION_RELEVANCE_API_BASE at an API that reports them.',
    )
  }
  const readinessAfter = await readReadiness(apiBase)
  const indexAfter = assertReadyLegislationIndex(
    readinessAfter,
    indexName,
    legislationRelevanceBaseline.expectedIndexDocumentCount,
  )

  const metrics = aggregateMetrics(results)
  const recordedBaseline = baselineFromResults(
    indexAfter.documentCount ?? 0,
    metrics,
    results,
  )
  const regressions = regressionFailures(
    legislationRelevanceBaseline,
    metrics,
    results,
  )
  const report = {
    benchmark: 'legislation-relevance',
    generatedAt: new Date().toISOString(),
    apiBase,
    provenance: legislationReportProvenance(runnerProvenance, apiProvenance),
    index: index.index,
    indexDocumentCount: index.documentCount,
    topK: legislationRelevanceTopK,
    searchParameters,
    liveIndexSettings,
    metrics,
    metricsByCategory: metricsByCategory(results),
    baseline: legislationRelevanceBaseline,
    recordedBaseline,
    cases: results,
    regressionFailures: regressions,
  }

  console.log(JSON.stringify(report, null, 2))
  await writeReport(report)

  if (
    regressions.length > 0 &&
    process.env.LEGISLATION_RELEVANCE_ALLOW_REGRESSION !== '1'
  ) {
    process.exitCode = 1
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
