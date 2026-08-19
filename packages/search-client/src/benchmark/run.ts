import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  createClient,
  createIndex,
  indexDocuments,
  legalSearchIndexSettings,
  search,
} from '../index'
import {
  searchBenchmarkCases,
  type SearchBenchmarkCase,
  type SearchBenchmarkCategory,
} from './cases'
import { searchBenchmarkBaseline } from './baseline'
import { searchBenchmarkDocuments } from './fixtures'

const host = process.env.SEARCH_BENCHMARK_HOST ?? 'http://127.0.0.1:7700'
const apiKey = process.env.SEARCH_BENCHMARK_API_KEY ?? 'search-benchmark-key'
const indexName = `legal-authorities-benchmark-${process.pid}`
const topKSize = 3
const resultLimit = 20
/**
 * Allow the run to continue against a Meilisearch too old for one of the index
 * settings, naming what it could not apply in the report.
 *
 * Off by default so CI, which pins 1.12.0, cannot drift into measuring a
 * configuration it did not intend. Set it locally when the only server
 * available is older, and read the reported `unsupportedSettings` before
 * comparing the numbers with anything: a 1.8 server cannot disable prefix
 * search, and `minimumShortWordPrecision` rests on prefix search being off.
 */
const allowUnsupportedSettings =
  process.env.SEARCH_BENCHMARK_ALLOW_UNSUPPORTED_SETTINGS === '1'

const knownFailingCaseIds = new Set<string>(
  searchBenchmarkBaseline.knownFailingCaseIds,
)

interface BenchmarkCaseResult {
  id: string
  category: SearchBenchmarkCategory
  query: string
  topK: string[]
  topKScores: Array<number | null>
  returnedHitCount: number
  relevantReturnedHitCount: number
  estimatedTotalHits: number
  processingTimeMs: number
  providerSearchTimeMs: number | null
  clientProcessingTimeMs: number | null
  wallClockSearchTimeMs: number
  relevantHitHasEvidence: boolean | null
  searchErrorMessage?: string
  failureLabels: string[]
}

function roundMetric(value: number) {
  return Number(value.toFixed(4))
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? null : roundMetric(numerator / denominator)
}

function percentile95(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null
}

function relevantIds(testCase: SearchBenchmarkCase) {
  if (testCase.expectedTopId) return [testCase.expectedTopId]
  return testCase.expectedCandidateIds ?? []
}

function failureLabels(
  testCase: SearchBenchmarkCase,
  topK: string[],
  hitIds: string[],
  relevantHitHasEvidence: boolean | null,
) {
  const labels: string[] = []
  if (testCase.expectedNoResults && hitIds.length > 0) {
    labels.push('unexpected_results')
  }
  if (testCase.expectedResults && hitIds.length === 0) {
    labels.push('expected_results_missing')
  }
  if (testCase.expectedTopId && topK[0] !== testCase.expectedTopId) {
    labels.push('top_1_miss')
  }
  if (testCase.expectedTopId && !topK.includes(testCase.expectedTopId)) {
    labels.push('top_3_miss')
  }
  if (
    testCase.expectedCandidateIds &&
    !testCase.expectedCandidateIds.every((id) => topK.includes(id))
  ) {
    labels.push('ambiguity_candidates_missing')
  }
  if (testCase.expectsEvidence && !relevantHitHasEvidence) {
    labels.push('evidence_missing')
  }
  if (
    testCase.category === 'short_word_precision' &&
    hitIds.some((id) => !relevantIds(testCase).includes(id))
  ) {
    labels.push('short_word_false_positive')
  }
  return labels
}

async function runCase(
  client: ReturnType<typeof createClient>,
  testCase: SearchBenchmarkCase,
): Promise<BenchmarkCaseResult> {
  try {
    const startedAt = performance.now()
    const result = await search(
      client,
      indexName,
      testCase.query,
      testCase.filters,
      { includeSnippets: true, limit: resultLimit },
    )
    const wallClockSearchTimeMs = performance.now() - startedAt
    const hitIds = result.hits.map((hit) => hit.id)
    const topKHits = result.hits.slice(0, topKSize)
    const topK = topKHits.map(({ id }) => id)
    const topKScores = topKHits.map(
      ({ engineRankingScore }) => engineRankingScore ?? null,
    )
    const relevantHit = result.hits.find((hit) =>
      relevantIds(testCase).includes(hit.id),
    )
    const relevantHitHasEvidence = testCase.expectsEvidence
      ? Boolean(relevantHit?.snippets?.length)
      : null

    return {
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      topK,
      topKScores,
      returnedHitCount: hitIds.length,
      relevantReturnedHitCount: hitIds.filter((id) =>
        relevantIds(testCase).includes(id),
      ).length,
      estimatedTotalHits: result.estimatedTotalHits,
      processingTimeMs: result.processingTimeMs,
      providerSearchTimeMs: result.diagnostics?.providerSearchTimeMs ?? null,
      clientProcessingTimeMs:
        result.diagnostics?.clientProcessingTimeMs ?? null,
      wallClockSearchTimeMs,
      relevantHitHasEvidence,
      failureLabels: [
        ...failureLabels(testCase, topK, hitIds, relevantHitHasEvidence),
        ...(topKScores.some((score) => score === null)
          ? ['engine_ranking_score_missing']
          : []),
      ],
    }
  } catch (error) {
    return {
      id: testCase.id,
      category: testCase.category,
      query: testCase.query,
      topK: [],
      topKScores: [],
      returnedHitCount: 0,
      relevantReturnedHitCount: 0,
      estimatedTotalHits: 0,
      processingTimeMs: 0,
      providerSearchTimeMs: null,
      clientProcessingTimeMs: null,
      wallClockSearchTimeMs: 0,
      relevantHitHasEvidence: testCase.expectsEvidence ? false : null,
      searchErrorMessage:
        error instanceof Error
          ? `${error.message}${
              error.cause instanceof Error
                ? ` (cause: ${error.cause.message})`
                : ''
            }`
          : String(error),
      failureLabels: [
        'search_error',
        ...failureLabels(testCase, [], [], false),
      ],
    }
  }
}

function categoryTop1(results: BenchmarkCaseResult[]) {
  const categories = Array.from(
    new Set(searchBenchmarkCases.map(({ category }) => category)),
  )
  return Object.fromEntries(
    categories.map((category) => {
      const cases = searchBenchmarkCases.filter(
        (testCase) =>
          testCase.category === category && Boolean(testCase.expectedTopId),
      )
      const succeeded = cases.filter(
        (testCase) =>
          results.find(({ id }) => id === testCase.id)?.topK[0] ===
          testCase.expectedTopId,
      ).length
      return [category, ratio(succeeded, cases.length)]
    }),
  )
}

function calculateMetrics(results: BenchmarkCaseResult[]) {
  const top1Cases = searchBenchmarkCases.filter(({ expectedTopId }) =>
    Boolean(expectedTopId),
  )
  const top1Successes = top1Cases.filter(
    (testCase) =>
      results.find(({ id }) => id === testCase.id)?.topK[0] ===
      testCase.expectedTopId,
  ).length
  const top3Successes = top1Cases.filter((testCase) =>
    results
      .find(({ id }) => id === testCase.id)
      ?.topK.includes(testCase.expectedTopId ?? ''),
  ).length
  const exactLookupCases = searchBenchmarkCases.filter(({ category }) =>
    ['exact_citation', 'provider_document_id'].includes(category),
  )
  const exactLookupSuccesses = exactLookupCases.filter(
    (testCase) =>
      results.find(({ id }) => id === testCase.id)?.topK[0] ===
      testCase.expectedTopId,
  ).length
  const shortWordCases = searchBenchmarkCases.filter(
    ({ category }) => category === 'short_word_precision',
  )
  const shortWordRelevantHits = shortWordCases.reduce(
    (total, testCase) =>
      total +
      (results.find(({ id }) => id === testCase.id)?.relevantReturnedHitCount ??
        0),
    0,
  )
  const shortWordReturnedHits = shortWordCases.reduce(
    (total, testCase) =>
      total +
      (results.find(({ id }) => id === testCase.id)?.returnedHitCount ?? 0),
    0,
  )
  const evidenceCases = searchBenchmarkCases.filter(
    ({ expectsEvidence }) => expectsEvidence,
  )
  const evidenceSuccesses = evidenceCases.filter(
    (testCase) =>
      results.find(({ id }) => id === testCase.id)?.relevantHitHasEvidence,
  ).length
  const contentWordRecallCases = searchBenchmarkCases.filter(
    ({ expectedResults }) => expectedResults,
  )
  const contentWordRecallCasesWithoutSearchErrors =
    contentWordRecallCases.filter(
      (testCase) =>
        !results
          .find(({ id }) => id === testCase.id)
          ?.failureLabels.includes('search_error'),
    )
  const contentWordRecallSuccesses =
    contentWordRecallCasesWithoutSearchErrors.filter((testCase) => {
      const result = results.find(({ id }) => id === testCase.id)
      return result !== undefined && result.returnedHitCount !== 0
    }).length
  const noAnswerCases = searchBenchmarkCases.filter(
    ({ category }) => category === 'no_answer',
  )
  const noAnswerCasesWithoutSearchErrors = noAnswerCases.filter(
    (testCase) =>
      !results
        .find(({ id }) => id === testCase.id)
        ?.failureLabels.includes('search_error'),
  )
  const noAnswerSuccesses = noAnswerCasesWithoutSearchErrors.filter(
    (testCase) =>
      results.find(({ id }) => id === testCase.id)?.returnedHitCount === 0,
  ).length
  const malformedCases = searchBenchmarkCases.filter(
    ({ category }) => category === 'malformed_citation',
  )
  const malformedNoResultCasesWithoutSearchErrors = malformedCases.filter(
    (testCase) =>
      testCase.expectedNoResults &&
      !results
        .find(({ id }) => id === testCase.id)
        ?.failureLabels.includes('search_error'),
  )
  const malformedSuccesses = malformedNoResultCasesWithoutSearchErrors.filter(
    (testCase) =>
      results.find(({ id }) => id === testCase.id)?.returnedHitCount === 0,
  ).length
  const ambiguityCases = searchBenchmarkCases.filter(
    ({ category }) => category === 'ambiguous_citation',
  )
  const ambiguitySuccesses = ambiguityCases.filter((testCase) => {
    const topK = results.find(({ id }) => id === testCase.id)?.topK ?? []
    return testCase.expectedCandidateIds?.every((id) => topK.includes(id))
  }).length

  return {
    caseCount: results.length,
    top1ExactSourceSuccess: ratio(top1Successes, top1Cases.length),
    top3ExactSourceSuccess: ratio(top3Successes, top1Cases.length),
    exactLookupTop1Success: ratio(
      exactLookupSuccesses,
      exactLookupCases.length,
    ),
    shortWordPrecision: ratio(shortWordRelevantHits, shortWordReturnedHits),
    evidenceUnitRecall: ratio(evidenceSuccesses, evidenceCases.length),
    noAnswerPrecision: ratio(
      noAnswerSuccesses,
      noAnswerCasesWithoutSearchErrors.length,
    ),
    contentWordRecall: ratio(
      contentWordRecallSuccesses,
      contentWordRecallCasesWithoutSearchErrors.length,
    ),
    malformedCitationNoResultRate: ratio(
      malformedSuccesses,
      malformedNoResultCasesWithoutSearchErrors.length,
    ),
    ambiguitySurfaced: ratio(ambiguitySuccesses, ambiguityCases.length),
    engineRankingScoreCoverage: ratio(
      results
        .flatMap(({ topKScores }) => topKScores)
        .filter((score) => score !== null).length,
      results.flatMap(({ topKScores }) => topKScores).length,
    ),
    searchErrorCount: results.filter(({ failureLabels }) =>
      failureLabels.includes('search_error'),
    ).length,
    searchWallClockP95Ms: percentile95(
      results
        .filter(({ failureLabels }) => !failureLabels.includes('search_error'))
        .map(({ wallClockSearchTimeMs }) => wallClockSearchTimeMs),
    ),
    top1ByCategory: categoryTop1(results),
  }
}

function regressionFailures(
  metrics: ReturnType<typeof calculateMetrics>,
  results: BenchmarkCaseResult[],
) {
  const failures: string[] = []
  if (metrics.caseCount !== searchBenchmarkBaseline.expectedCaseCount) {
    failures.push(
      `case_count:${metrics.caseCount}!=expected:${searchBenchmarkBaseline.expectedCaseCount}`,
    )
  }

  const minimums = [
    [
      'top_1',
      metrics.top1ExactSourceSuccess,
      searchBenchmarkBaseline.minimumTop1ExactSourceSuccess,
    ],
    [
      'top_3',
      metrics.top3ExactSourceSuccess,
      searchBenchmarkBaseline.minimumTop3ExactSourceSuccess,
    ],
    [
      'exact_lookup_top_1',
      metrics.exactLookupTop1Success,
      searchBenchmarkBaseline.minimumExactLookupTop1Success,
    ],
    [
      'short_word_precision',
      metrics.shortWordPrecision,
      searchBenchmarkBaseline.minimumShortWordPrecision,
    ],
    [
      'evidence_unit_recall',
      metrics.evidenceUnitRecall,
      searchBenchmarkBaseline.minimumEvidenceUnitRecall,
    ],
    [
      'no_answer_precision',
      metrics.noAnswerPrecision,
      searchBenchmarkBaseline.minimumNoAnswerPrecision,
    ],
    [
      'content_word_recall',
      metrics.contentWordRecall,
      searchBenchmarkBaseline.minimumContentWordRecall,
    ],
    [
      'malformed_citation_no_result_rate',
      metrics.malformedCitationNoResultRate,
      searchBenchmarkBaseline.minimumMalformedCitationNoResultRate,
    ],
    [
      'ambiguity_surfaced',
      metrics.ambiguitySurfaced,
      searchBenchmarkBaseline.minimumAmbiguitySurfaced,
    ],
    [
      'engine_ranking_score_coverage',
      metrics.engineRankingScoreCoverage,
      searchBenchmarkBaseline.minimumEngineRankingScoreCoverage,
    ],
  ] as const

  for (const [label, actual, minimum] of minimums) {
    if (actual === null) {
      failures.push(`${label}:no_data`)
    } else if (actual < minimum) {
      failures.push(`${label}:${actual}<minimum:${minimum}`)
    }
  }
  for (const result of results) {
    const hasSearchError = result.failureLabels.includes('search_error')
    const isKnownFailingCase = knownFailingCaseIds.has(result.id)
    if (hasSearchError && !isKnownFailingCase) {
      failures.push(`unexpected_search_error:${result.id}`)
    }
    if (!hasSearchError && isKnownFailingCase) {
      failures.push(`known_failing_case_unexpected_pass:${result.id}`)
    }
  }
  if (metrics.searchWallClockP95Ms === null) {
    failures.push('search_wall_clock_p95:no_data')
  } else if (
    metrics.searchWallClockP95Ms >
    searchBenchmarkBaseline.maximumSearchWallClockP95Ms
  ) {
    failures.push(
      `search_wall_clock_p95:${metrics.searchWallClockP95Ms}>maximum:${searchBenchmarkBaseline.maximumSearchWallClockP95Ms}`,
    )
  }
  return failures
}

async function writeReport(report: unknown) {
  const reportPath = process.env.SEARCH_BENCHMARK_REPORT_PATH
  if (!reportPath) return
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

async function main() {
  if (
    searchBenchmarkCases.length !== searchBenchmarkBaseline.expectedCaseCount
  ) {
    throw new Error(
      `Search benchmark defines ${searchBenchmarkCases.length} cases; expected ${searchBenchmarkBaseline.expectedCaseCount}.`,
    )
  }

  const client = createClient(host, apiKey)

  try {
    const indexSetup = await createIndex(client, indexName, {
      allowUnsupportedSettings,
    })
    const indexed = await indexDocuments(
      client,
      indexName,
      searchBenchmarkDocuments,
    )
    if (indexed.failedCount > 0) {
      throw new Error(
        `Search benchmark failed to index ${indexed.failedCount} fixture documents.`,
      )
    }

    const results: BenchmarkCaseResult[] = []
    for (const testCase of searchBenchmarkCases) {
      results.push(await runCase(client, testCase))
    }

    const metrics = calculateMetrics(results)
    const regressions = regressionFailures(metrics, results)
    const report = {
      benchmark: 'search-correctness-gate-1',
      generatedAt: new Date().toISOString(),
      fixtureDocumentCount: searchBenchmarkDocuments.length,
      metrics,
      // The configuration this run applied. Reported so every artifact states
      // the settings it was measured under, and a summary that disagrees with
      // the committed value is contradicted by its own evidence.
      indexSettings: legalSearchIndexSettings,
      // What the server actually applied. Empty is the expected state; anything
      // here means the run measured a configuration this package does not
      // define, and the numbers are not comparable with a run where it did.
      unsupportedIndexSettings: indexSetup.unsupportedSettings,
      baseline: searchBenchmarkBaseline,
      cases: results,
      regressionFailures: regressions,
    }

    if (indexSetup.unsupportedSettings.length > 0) {
      console.error(
        `WARNING: the server could not apply ${indexSetup.unsupportedSettings.join(', ')}. These numbers were measured under a different search configuration from the one this package defines.`,
      )
    }

    console.log(JSON.stringify(report, null, 2))
    await writeReport(report)

    if (
      regressions.length > 0 &&
      process.env.SEARCH_BENCHMARK_ALLOW_REGRESSION !== '1'
    ) {
      process.exitCode = 1
    }
  } finally {
    await client
      .deleteIndex(indexName)
      .waitTask({
        timeout: 30_000,
        interval: 100,
      })
      .catch((error) => {
        console.warn('Search benchmark index cleanup failed.', error)
      })
  }
}

await main()
