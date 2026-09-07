/**
 * Served-path relevance suite. Hits POST /api/search/fetch against the local
 * product corpus. Not a CI gate: CI has no 37k-document index. Run before and
 * after ranking changes:
 *
 *   pnpm benchmark:search-corpus
 *
 * Requires GET /api/search/readiness to report ready with the baseline
 * document count, and Postgres to hold the same corpus. Do not ingest while
 * measuring.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { corpusRelevanceBaseline } from './baseline'
import {
  completeCourtFamilies,
  corpusRelevanceCases,
  corpusRelevanceTopK,
} from './cases'
import {
  assertReadyCorpus,
  defaultApiBase,
  defaultDatabaseUrl,
  readReadiness,
  runCases,
  verifyCorpusExpectations,
} from './corpus'
import {
  aggregateMetrics,
  baselineFromResults,
  regressionFailures,
} from './metrics'

async function writeReport(report: unknown) {
  const reportPath = process.env.SEARCH_CORPUS_RELEVANCE_REPORT_PATH
  if (!reportPath) return
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function main() {
  if (
    corpusRelevanceCases.length !== corpusRelevanceBaseline.expectedCaseCount
  ) {
    throw new Error(
      `Corpus relevance suite defines ${corpusRelevanceCases.length} cases; expected ${corpusRelevanceBaseline.expectedCaseCount}.`,
    )
  }

  const apiBase = defaultApiBase()
  const databaseUrl = defaultDatabaseUrl()
  const readiness = await readReadiness(apiBase)
  assertReadyCorpus(readiness, corpusRelevanceBaseline.expectedDocumentCount)
  await verifyCorpusExpectations(databaseUrl)

  const results = await runCases(apiBase)
  const readinessAfter = await readReadiness(apiBase)
  if (readinessAfter.documentCount !== readiness.documentCount) {
    throw new Error(
      `Corpus size changed during the run (${readiness.documentCount} -> ${readinessAfter.documentCount}). Do not ingest while measuring.`,
    )
  }

  const metrics = aggregateMetrics(results)
  const recordedBaseline = baselineFromResults(
    readiness.documentCount ?? 0,
    metrics,
    results,
  )
  const regressions = regressionFailures(
    corpusRelevanceBaseline,
    metrics,
    results,
  )
  const report = {
    benchmark: 'search-corpus-relevance',
    generatedAt: new Date().toISOString(),
    apiBase,
    index: readiness.index,
    documentCount: readiness.documentCount,
    topK: corpusRelevanceTopK,
    completeCourtFamilies,
    metrics,
    baseline: corpusRelevanceBaseline,
    recordedBaseline,
    cases: results,
    regressionFailures: regressions,
  }

  console.log(JSON.stringify(report, null, 2))
  await writeReport(report)

  if (
    regressions.length > 0 &&
    process.env.SEARCH_CORPUS_RELEVANCE_ALLOW_REGRESSION !== '1'
  ) {
    process.exitCode = 1
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
