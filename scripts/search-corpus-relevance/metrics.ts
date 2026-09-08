import type { CorpusRelevanceCase } from './cases'

export interface CaseQueryBaseline {
  recall: number | null
  ranks: Array<number | null>
  returnedHitCount: number
}

export interface CorpusRelevanceBaseline {
  expectedCaseCount: number
  expectedDocumentCount: number
  heldRecall: number
  heldPrecision: number
  absentPrecision: number
  mrr: number
  byQuery: Record<string, CaseQueryBaseline>
}

export interface CaseResult {
  id: string
  kind: CorpusRelevanceCase['kind']
  category: CorpusRelevanceCase['category']
  query: string
  returnedIds: string[]
  returnedHitCount: number
  /**
   * Labelled citing hits exempted from absent scoring. An anonymous
   * recognised-citation query honestly serves stored judgments that cite
   * the absent citation (citationMatch 'citing', status not_held); those
   * are the distinguished not-held-with-citing answer, not false positives
   * claiming to be the judgment, so they score and count separately here.
   */
  exemptLabelledCitingCount: number
  ranks: Array<number | null>
  recall: number | null
  precision: number | null
  mrr: number | null
  storedIndexStatus: string | null
  outcome: string | null
  failureLabels: string[]
  searchErrorMessage?: string
}

export interface CorpusRelevanceMetrics {
  caseCount: number
  heldRecall: number | null
  heldPrecision: number | null
  absentPrecision: number | null
  mrr: number | null
}

export function roundMetric(value: number) {
  return Number(value.toFixed(4))
}

function mean(values: number[]) {
  if (values.length === 0) return null
  return roundMetric(
    values.reduce((total, value) => total + value, 0) / values.length,
  )
}

export function rankOf(returnedIds: string[], expectedId: string) {
  const index = returnedIds.indexOf(expectedId)
  return index === -1 ? null : index + 1
}

export function scoreCase(
  testCase: CorpusRelevanceCase,
  returnedIds: string[],
  options: {
    storedIndexStatus?: string | null
    outcome?: string | null
    searchErrorMessage?: string
    exemptLabelledCitingCount?: number
  } = {},
): CaseResult {
  const exemptLabelledCitingCount = options.exemptLabelledCitingCount ?? 0
  const ranks = testCase.expectedIds.map((id) => rankOf(returnedIds, id))
  const failureLabels: string[] = []
  if (options.searchErrorMessage) failureLabels.push('search_error')
  if (options.storedIndexStatus === 'unavailable') {
    failureLabels.push('stored_index_unavailable')
  }

  if (testCase.kind === 'absent') {
    if (returnedIds.length > 0) failureLabels.push('absent_hits')
    return {
      id: testCase.id,
      kind: testCase.kind,
      category: testCase.category,
      query: testCase.query,
      returnedIds,
      returnedHitCount: returnedIds.length,
      exemptLabelledCitingCount,
      ranks,
      recall: null,
      precision: returnedIds.length === 0 ? 1 : 0,
      mrr: null,
      storedIndexStatus: options.storedIndexStatus ?? null,
      outcome: options.outcome ?? null,
      failureLabels,
      searchErrorMessage: options.searchErrorMessage,
    }
  }

  const found = ranks.filter((rank) => rank !== null).length
  const recall =
    testCase.expectedIds.length === 0
      ? null
      : roundMetric(found / testCase.expectedIds.length)
  const precision =
    returnedIds.length === 0
      ? 0
      : roundMetric(
          returnedIds.filter((id) => testCase.expectedIds.includes(id)).length /
            returnedIds.length,
        )
  const primaryRank = ranks[0] ?? null
  if (recall !== 1) failureLabels.push('held_miss')
  return {
    id: testCase.id,
    kind: testCase.kind,
    category: testCase.category,
    query: testCase.query,
    returnedIds,
    returnedHitCount: returnedIds.length,
    exemptLabelledCitingCount,
    ranks,
    recall,
    precision,
    mrr: primaryRank === null ? 0 : roundMetric(1 / primaryRank),
    storedIndexStatus: options.storedIndexStatus ?? null,
    outcome: options.outcome ?? null,
    failureLabels,
    searchErrorMessage: options.searchErrorMessage,
  }
}

/**
 * Splits an absent query's served hits into scoring ids and exempt citing
 * ids. Only hits the API explicitly labels `citing` are exempt: exact,
 * none, and unlabeled hits (pre-label servers) still count, so a broken
 * phrase lookup that serves keyword neighbours keeps failing loudly.
 */
export function splitAbsentScoringIds(
  hits: ReadonlyArray<{ id: string; citationMatch?: string | null }>,
): { violatingIds: string[]; exemptLabelledCitingCount: number } {
  const violatingIds: string[] = []
  let exemptLabelledCitingCount = 0
  for (const hit of hits) {
    if (hit.citationMatch === 'citing') exemptLabelledCitingCount += 1
    else violatingIds.push(hit.id)
  }
  return { violatingIds, exemptLabelledCitingCount }
}

export function aggregateMetrics(
  results: CaseResult[],
): CorpusRelevanceMetrics {
  const held = results.filter((result) => result.kind === 'held')
  const absent = results.filter((result) => result.kind === 'absent')
  const heldRecallValues = held
    .map((result) => result.recall)
    .filter((value): value is number => value !== null)
  const heldPrecisionValues = held
    .map((result) => result.precision)
    .filter((value): value is number => value !== null)
  const absentPrecisionValues = absent
    .map((result) => result.precision)
    .filter((value): value is number => value !== null)
  const mrrValues = held
    .map((result) => result.mrr)
    .filter((value): value is number => value !== null)
  return {
    caseCount: results.length,
    heldRecall: mean(heldRecallValues),
    heldPrecision: mean(heldPrecisionValues),
    absentPrecision: mean(absentPrecisionValues),
    mrr: mean(mrrValues),
  }
}

/**
 * Compare a run to the committed baseline. Rank and hit-count ceilings fail
 * on regression only: a better rank or a quieter decoy is an improvement and
 * must not fail the instrument (P13).
 */
export function regressionFailures(
  baseline: CorpusRelevanceBaseline,
  metrics: CorpusRelevanceMetrics,
  results: CaseResult[],
): string[] {
  const failures: string[] = []
  if (metrics.caseCount !== baseline.expectedCaseCount) {
    failures.push(
      `case_count:${metrics.caseCount}!=expected:${baseline.expectedCaseCount}`,
    )
  }
  const floors = [
    ['held_recall', metrics.heldRecall, baseline.heldRecall],
    ['held_precision', metrics.heldPrecision, baseline.heldPrecision],
    ['absent_precision', metrics.absentPrecision, baseline.absentPrecision],
    ['mrr', metrics.mrr, baseline.mrr],
  ] as const
  for (const [label, actual, minimum] of floors) {
    if (actual === null) failures.push(`${label}:no_data`)
    else if (actual < minimum) {
      failures.push(`${label}:${actual}<minimum:${minimum}`)
    }
  }

  for (const result of results) {
    const expected = baseline.byQuery[result.id]
    if (!expected) {
      failures.push(`missing_baseline:${result.id}`)
      continue
    }
    if (result.kind === 'held') {
      if (
        expected.recall !== null &&
        result.recall !== null &&
        result.recall < expected.recall
      ) {
        failures.push(
          `recall_drop:${result.id}:${result.recall}<minimum:${expected.recall}`,
        )
      }
      const rankCount = Math.max(expected.ranks.length, result.ranks.length)
      for (let index = 0; index < rankCount; index++) {
        const previous = expected.ranks[index]
        const actual = result.ranks[index]
        if (previous === undefined || previous === null) continue
        if (actual === undefined || actual === null) {
          failures.push(
            `rank_drop:${result.id}:${index}:absent>previous:${previous}`,
          )
        } else if (actual > previous) {
          failures.push(
            `rank_drop:${result.id}:${index}:${actual}>previous:${previous}`,
          )
        }
      }
    } else if (result.returnedHitCount > expected.returnedHitCount) {
      failures.push(
        `absent_hits_up:${result.id}:${result.returnedHitCount}>previous:${expected.returnedHitCount}`,
      )
    }
  }

  for (const result of results) {
    if (result.failureLabels.includes('search_error')) {
      failures.push(`search_error:${result.id}`)
    }
  }

  return failures
}

export function baselineFromResults(
  documentCount: number,
  metrics: CorpusRelevanceMetrics,
  results: CaseResult[],
): CorpusRelevanceBaseline {
  if (
    metrics.heldRecall === null ||
    metrics.heldPrecision === null ||
    metrics.absentPrecision === null ||
    metrics.mrr === null
  ) {
    throw new Error('Cannot record a baseline without held and absent metrics.')
  }
  return {
    expectedCaseCount: results.length,
    expectedDocumentCount: documentCount,
    heldRecall: metrics.heldRecall,
    heldPrecision: metrics.heldPrecision,
    absentPrecision: metrics.absentPrecision,
    mrr: metrics.mrr,
    byQuery: Object.fromEntries(
      results.map((result) => [
        result.id,
        {
          recall: result.recall,
          ranks: result.ranks,
          returnedHitCount: result.returnedHitCount,
        },
      ]),
    ),
  }
}
