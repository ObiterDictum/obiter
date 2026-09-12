/**
 * Legislation relevance suite. Measures POST /api/search/fetch on the
 * legislation_provisions corpus and reports held recall, held precision,
 * absent precision, and MRR — the four numbers the judgment corpus suite
 * (scripts/search-corpus-relevance) measures, kept deliberately separate
 * because a short provision and a long judgment are not the same ranking
 * problem.
 *
 * Not a CI gate: CI has no 185k-document provision index and no
 * legislation corpus in Postgres. Run before and after any ranking change to
 * the legislation index, the provision serve path, or the relevance floor:
 *
 *   LEGISLATION_RELEVANCE_API_BASE=http://127.0.0.1:8789 pnpm benchmark:legislation-corpus
 *
 * The suite reads the served path, not the raw index, so the citation
 * classification and the Postgres exact path are inside the measurement: a
 * bare Act title is answered by the Act document (since #184), and measuring
 * the index directly would score a result set no caller receives.
 *
 * Point LEGISLATION_RELEVANCE_API_BASE at the API serving the checkout under
 * test. /api/health provenance is recorded in the report and printed to
 * stderr, because a suite run against a stale server reads as authoritative
 * and is not. The report records the search-time parameters the server reports
 * applying, and the run refuses when the server reports none: matchingStrategy
 * is request-time, so nothing else can reveal it and this checkout's constant
 * would mislabel the run. It refuses to measure unless
 * GET /api/search/readiness reports the legislation index ready at the baseline
 * document count, and it re-checks every held id and every absent expectation
 * against Postgres first. Do not rebuild the index while it is running.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { legislationRelevanceBaseline } from './baseline'
import { legislationRelevanceCases, legislationRelevanceTopK } from './cases'
import {
  assertReadyLegislationIndex,
  defaultApiBase,
  defaultDatabaseUrl,
  defaultLegislationIndexName,
  readApiProvenance,
  readLiveIndexSettings,
  readReadiness,
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

  const readiness = await readReadiness(apiBase)
  const index = assertReadyLegislationIndex(
    readiness,
    indexName,
    legislationRelevanceBaseline.expectedIndexDocumentCount,
  )
  await verifyLegislationExpectations(databaseUrl)

  const provenance = await readApiProvenance(apiBase)
  console.error(
    `Measuring ${apiBase} (${provenance.checkoutRoot ?? 'provenance not reported'} @ ${provenance.commitSha ?? 'unknown'}) against ${indexName}.`,
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
    provenance,
    index: index.index,
    indexDocumentCount: index.documentCount,
    topK: legislationRelevanceTopK,
    // What the measured server reported applying, not this checkout's
    // configured constants. matchingStrategy is request-time, so no index
    // setting reveals it, and the server may be running a different checkout:
    // an asserted constant would misstate a run against a pre-#184 server as
    // having used 'all'.
    searchParameters,
    // What the shared index actually has. Fetched from Meilisearch, so it is
    // observed rather than declared, but it is index-time only — it cannot
    // reveal the request-time parameters above.
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
