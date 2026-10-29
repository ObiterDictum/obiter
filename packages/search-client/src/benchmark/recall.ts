import { search } from '../index'
import type { MeiliSearch } from 'meilisearch'
import { searchBenchmarkBaseline } from './baseline'
import type { SearchRecallQuery } from './cases'

export const recallTopK = 10

export interface RecallQueryResult {
  id: string
  query: string
  returnedIds: string[]
  unindexedRelevantIds: string[]
  recall: number | null
  decoyNoResults: boolean | null
}

function roundMetric(value: number) {
  return Number(value.toFixed(4))
}

export async function runRecallQuery(
  client: MeiliSearch,
  indexName: string,
  testCase: SearchRecallQuery,
  indexedIds: Set<string>,
): Promise<RecallQueryResult> {
  const result = await search(
    client,
    indexName,
    testCase.query,
    testCase.filters ?? {},
    { includeSnippets: false, limit: recallTopK },
  )
  const returnedIds = result.hits.map((hit) => hit.id)
  const unindexedRelevantIds = testCase.relevantIds.filter(
    (id) => !indexedIds.has(id),
  )
  if (testCase.expectNoResults) {
    return {
      id: testCase.id,
      query: testCase.query,
      returnedIds,
      unindexedRelevantIds,
      recall: null,
      decoyNoResults: returnedIds.length === 0,
    }
  }
  const found = testCase.relevantIds.filter((id) =>
    returnedIds.includes(id),
  ).length
  return {
    id: testCase.id,
    query: testCase.query,
    returnedIds,
    unindexedRelevantIds,
    recall:
      testCase.relevantIds.length === 0
        ? null
        : roundMetric(found / testCase.relevantIds.length),
    decoyNoResults: null,
  }
}

export interface RecallMetrics {
  queryCount: number
  recall: number | null
  precision: number | null
}

export function scoreRecallQueries(
  results: RecallQueryResult[],
): RecallMetrics {
  const recallValues = results
    .map(({ recall }) => recall)
    .filter((value): value is number => value !== null)
  const decoys = results.filter(({ decoyNoResults }) => decoyNoResults !== null)
  return {
    queryCount: results.length,
    recall:
      recallValues.length === 0
        ? null
        : roundMetric(
            recallValues.reduce((total, value) => total + value, 0) /
              recallValues.length,
          ),
    precision:
      decoys.length === 0
        ? null
        : roundMetric(
            decoys.filter(({ decoyNoResults }) => decoyNoResults).length /
              decoys.length,
          ),
  }
}

export function recallRegressionFailures(
  metrics: RecallMetrics,
  results: RecallQueryResult[],
): string[] {
  const failures: string[] = []
  if (metrics.queryCount !== searchBenchmarkBaseline.expectedRecallQueryCount) {
    failures.push(
      `recall_case_count:${metrics.queryCount}!=expected:${searchBenchmarkBaseline.expectedRecallQueryCount}`,
    )
  }
  if (metrics.recall === null) {
    failures.push('recall:no_data')
  } else if (metrics.recall < searchBenchmarkBaseline.minimumRecall) {
    failures.push(
      `recall:${metrics.recall}<minimum:${searchBenchmarkBaseline.minimumRecall}`,
    )
  }
  if (metrics.precision === null) {
    failures.push('recall_precision:no_data')
  } else if (metrics.precision < searchBenchmarkBaseline.minimumPrecision) {
    failures.push(
      `recall_precision:${metrics.precision}<minimum:${searchBenchmarkBaseline.minimumPrecision}`,
    )
  }
  for (const result of results) {
    if (result.recall !== null) {
      const minimum =
        searchBenchmarkBaseline.minimumRecallByQuery[result.id] ?? 0
      if (result.recall < minimum) {
        failures.push(
          `recall_drop:${result.id}:${result.recall}<minimum:${minimum}`,
        )
      }
    }
    if (result.decoyNoResults === false) {
      failures.push(
        `precision_drop:${result.id}:returned_${result.returnedIds.length}`,
      )
    }
  }
  return failures
}
