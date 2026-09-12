import type { LegislationRelevanceCase } from './cases'

export interface CaseQueryBaseline {
  recall: number | null
  ranks: Array<number | null>
  returnedHitCount: number
}

export interface LegislationRelevanceBaseline {
  expectedCaseCount: number
  /** Live legislation_provisions index documentCount this baseline was taken at. */
  expectedIndexDocumentCount: number
  heldRecall: number
  /** Mean precision over complete-answer (exact) held cases only. */
  heldPrecision: number
  absentPrecision: number
  mrr: number
  byQuery: Record<string, CaseQueryBaseline>
}

export interface LegislationRelevanceMetrics {
  caseCount: number
  heldRecall: number | null
  heldPrecision: number | null
  absentPrecision: number | null
  mrr: number | null
  /** Supporting splits: exact cases are the ones precision is computed over. */
  exactHeldRecall: number | null
  subjectRecall: number | null
}

export interface CaseResult {
  id: string
  kind: LegislationRelevanceCase['kind']
  category: LegislationRelevanceCase['category']
  scoring: LegislationRelevanceCase['scoring']
  query: string
  /**
   * Canonical `documentIdentity/labelPath` served in the legislation group.
   * The served id differs by retrieval path (Postgres exact hits keep the
   * slash path, index keyword hits are hyphenated), so scoring reads the two
   * fields that are stable across both.
   */
  returnedIds: string[]
  returnedHitCount: number
  ranks: Array<number | null>
  recall: number | null
  precision: number | null
  mrr: number | null
  outcome: string | null
  legislationNote: string | null
  failureLabels: string[]
  searchErrorMessage?: string
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

export function canonicalLegislationId(hit: {
  documentIdentity?: string | null
  labelPath?: string | null
}) {
  const identity = hit.documentIdentity ?? ''
  const labelPath = hit.labelPath ?? ''
  return labelPath ? `${identity}/${labelPath}` : identity
}

/**
 * A subject expectation names a provision; a returned subsection of that
 * provision answers the same query, so the comparison is by subtree. An exact
 * expectation is one entity and compares by equality, so a neighbouring
 * provision counts as the false positive it is.
 */
export function matchesExpected(
  returnedId: string,
  expectedId: string,
  scoring: LegislationRelevanceCase['scoring'],
) {
  if (returnedId === expectedId) return true
  return scoring === 'subject' && returnedId.startsWith(`${expectedId}/`)
}

export function rankOf(
  returnedIds: string[],
  expectedId: string,
  scoring: LegislationRelevanceCase['scoring'],
) {
  const index = returnedIds.findIndex((returnedId) =>
    matchesExpected(returnedId, expectedId, scoring),
  )
  return index === -1 ? null : index + 1
}

export function scoreCase(
  testCase: LegislationRelevanceCase,
  returnedIds: string[],
  options: {
    outcome?: string | null
    legislationNote?: string | null
    searchErrorMessage?: string
  } = {},
): CaseResult {
  const failureLabels: string[] = []
  if (options.searchErrorMessage) failureLabels.push('search_error')
  const base = {
    id: testCase.id,
    kind: testCase.kind,
    category: testCase.category,
    scoring: testCase.scoring,
    query: testCase.query,
    returnedIds,
    returnedHitCount: returnedIds.length,
    outcome: options.outcome ?? null,
    legislationNote: options.legislationNote ?? null,
    searchErrorMessage: options.searchErrorMessage,
  }

  if (testCase.kind === 'absent') {
    const noiseFree = returnedIds.length === 0
    if (!noiseFree) failureLabels.push('absent_hits')
    return {
      ...base,
      ranks: [],
      recall: null,
      precision: noiseFree ? 1 : 0,
      mrr: null,
      failureLabels,
    }
  }

  const ranks = testCase.expectedIds.map((id) =>
    rankOf(returnedIds, id, testCase.scoring),
  )
  const found = ranks.filter((rank) => rank !== null).length
  const recall =
    testCase.expectedIds.length === 0
      ? null
      : roundMetric(found / testCase.expectedIds.length)
  const precision =
    testCase.scoring !== 'exact'
      ? null
      : returnedIds.length === 0
        ? 0
        : roundMetric(
            returnedIds.filter((returnedId) =>
              testCase.expectedIds.includes(returnedId),
            ).length / returnedIds.length,
          )
  const primaryRank = ranks[0] ?? null
  if (recall !== 1) failureLabels.push('held_miss')
  return {
    ...base,
    ranks,
    recall,
    precision,
    mrr: primaryRank === null ? 0 : roundMetric(1 / primaryRank),
    failureLabels,
  }
}

export function aggregateMetrics(
  results: CaseResult[],
): LegislationRelevanceMetrics {
  const held = results.filter((result) => result.kind === 'held')
  const exactHeld = held.filter((result) => result.scoring === 'exact')
  const subject = held.filter((result) => result.scoring === 'subject')
  const absent = results.filter((result) => result.kind === 'absent')
  return {
    caseCount: results.length,
    heldRecall: mean(
      held
        .map((result) => result.recall)
        .filter((value): value is number => value !== null),
    ),
    heldPrecision: mean(
      exactHeld
        .map((result) => result.precision)
        .filter((value): value is number => value !== null),
    ),
    absentPrecision: mean(
      absent
        .map((result) => result.precision)
        .filter((value): value is number => value !== null),
    ),
    mrr: mean(
      held
        .map((result) => result.mrr)
        .filter((value): value is number => value !== null),
    ),
    exactHeldRecall: mean(
      exactHeld
        .map((result) => result.recall)
        .filter((value): value is number => value !== null),
    ),
    subjectRecall: mean(
      subject
        .map((result) => result.recall)
        .filter((value): value is number => value !== null),
    ),
  }
}

/**
 * Compare a run to the committed baseline. Rank and hit-count ceilings fail
 * on regression only: a better rank or a quieter absent query is an
 * improvement and must not fail the instrument.
 */
export function regressionFailures(
  baseline: LegislationRelevanceBaseline,
  metrics: LegislationRelevanceMetrics,
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
    if (result.failureLabels.includes('search_error')) {
      failures.push(`search_error:${result.id}`)
    }
  }

  return failures
}

export function baselineFromResults(
  indexDocumentCount: number,
  metrics: LegislationRelevanceMetrics,
  results: CaseResult[],
): LegislationRelevanceBaseline {
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
    expectedIndexDocumentCount: indexDocumentCount,
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
