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
  /** Held cases that returned an authoritative not-held claim. Must be 0. */
  heldNotHeldViolations: number
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
  /** Held cases that returned diagnostics.legislationNotHeld. Must be 0. */
  heldNotHeldViolations: number
  /** Cases whose result was the unresolved-title suppression. Reported
   * separately so it is never counted as an authoritative not-held success. */
  unresolvedTitleCases: number
  /** Absent cases answered with an authoritative not-held claim. */
  absentAuthoritativeNotHeld: number
  /** Absent cases answered with the unresolved-title suppression. */
  absentTitleUnresolved: number
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
  /** The API marked this a not-held verdict. */
  legislationNotHeld: boolean
  /** The API marked this an unresolved whole-title request. */
  legislationTitleUnresolved: boolean
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
    legislationNotHeld?: boolean
    legislationTitleUnresolved?: boolean
    searchErrorMessage?: string
  } = {},
): CaseResult {
  const failureLabels: string[] = []
  if (options.searchErrorMessage) failureLabels.push('search_error')
  const legislationNotHeld = options.legislationNotHeld === true
  const legislationTitleUnresolved = options.legislationTitleUnresolved === true
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
    legislationNotHeld,
    legislationTitleUnresolved,
    searchErrorMessage: options.searchErrorMessage,
  }

  // A control query's right answer is a negative: it must not assert not-held
  // or claim an exact title it could not resolve. Hit count is not scored.
  if (testCase.kind === 'control') {
    if (legislationNotHeld) failureLabels.push('control_false_not_held')
    if (legislationTitleUnresolved)
      failureLabels.push('control_title_unresolved')
    return {
      ...base,
      ranks: [],
      recall: null,
      precision: null,
      mrr: null,
      failureLabels,
    }
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

  // The false not-held is the defect this suite exists to catch: a held
  // expectation must never receive an authoritative not-held verdict.
  if (legislationNotHeld) failureLabels.push('held_false_not_held')
  if (legislationTitleUnresolved) failureLabels.push('held_title_unresolved')

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
    heldNotHeldViolations: held.filter((result) => result.legislationNotHeld)
      .length,
    unresolvedTitleCases: results.filter(
      (result) => result.legislationTitleUnresolved,
    ).length,
    absentAuthoritativeNotHeld: absent.filter(
      (result) => result.legislationNotHeld,
    ).length,
    absentTitleUnresolved: absent.filter(
      (result) => result.legislationTitleUnresolved,
    ).length,
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
    // The explicit invariant: no held expectation may return an authoritative
    // not-held verdict, and no control may make either unsupported claim.
    if (result.kind !== 'absent' && result.legislationNotHeld) {
      failures.push(`false_not_held:${result.id}`)
    }
    if (result.kind === 'held' && result.legislationTitleUnresolved) {
      failures.push(`held_title_unresolved:${result.id}`)
    }
    if (result.kind === 'control' && result.legislationTitleUnresolved) {
      failures.push(`control_title_unresolved:${result.id}`)
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
    heldNotHeldViolations: metrics.heldNotHeldViolations,
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
