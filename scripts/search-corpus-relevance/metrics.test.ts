import { describe, expect, it } from 'vitest'
import type { CorpusRelevanceCase } from './cases'
import {
  aggregateMetrics,
  rankOf,
  regressionFailures,
  roundMetric,
  scoreCase,
  type CorpusRelevanceBaseline,
} from './metrics'

const heldCase: CorpusRelevanceCase = {
  id: 'party-example',
  kind: 'held',
  category: 'party_name',
  query: 'Example',
  expectedIds: ['uksc-2021-3'],
  courtFamily: 'uksc',
}

const multiHeld: CorpusRelevanceCase = {
  id: 'party-multi',
  kind: 'held',
  category: 'party_name',
  query: 'Radmacher',
  expectedIds: ['uksc-2010-42', 'ewca-civ-2009-649'],
  courtFamily: 'uksc',
}

const absentCase: CorpusRelevanceCase = {
  id: 'absent-example',
  kind: 'absent',
  category: 'neutral_citation',
  query: '[2023] EWCA Civ 123',
  expectedIds: [],
  courtFamily: 'ewca-civ',
}

function baseline(
  overrides: Partial<CorpusRelevanceBaseline> = {},
): CorpusRelevanceBaseline {
  return {
    expectedCaseCount: 2,
    expectedDocumentCount: 37936,
    heldRecall: 1,
    heldPrecision: 0.05,
    absentPrecision: 0,
    mrr: 1,
    byQuery: {
      'party-example': { recall: 1, ranks: [1], returnedHitCount: 20 },
      'absent-example': { recall: null, ranks: [], returnedHitCount: 20 },
    },
    ...overrides,
  }
}

describe('corpus relevance metrics', () => {
  it('reports the 1-based rank of the expected document', () => {
    const result = scoreCase(heldCase, ['other', 'uksc-2021-3'])
    expect(result.ranks).toEqual([2])
    expect(result.recall).toBe(1)
    expect(result.mrr).toBe(0.5)
    expect(result.failureLabels).toEqual([])
  })

  it('treats a held document missing from the returned list as recall 0', () => {
    const result = scoreCase(heldCase, ['other-a', 'other-b'])
    expect(result.ranks).toEqual([null])
    expect(result.recall).toBe(0)
    expect(result.mrr).toBe(0)
    expect(result.failureLabels).toEqual(['held_miss'])
  })

  it('scores absent queries as precision 1 only when nothing is returned', () => {
    expect(scoreCase(absentCase, []).precision).toBe(1)
    const noisy = scoreCase(absentCase, ['uksc-2024-33'])
    expect(noisy.precision).toBe(0)
    expect(noisy.failureLabels).toEqual(['absent_hits'])
  })

  it('guards precision against a zero returned set on held queries', () => {
    const result = scoreCase(heldCase, [])
    expect(result.precision).toBe(0)
    expect(result.recall).toBe(0)
  })

  it('averages recall across expected ids on a multi-document query', () => {
    const result = scoreCase(multiHeld, ['uksc-2010-42', 'other'])
    expect(result.ranks).toEqual([1, null])
    expect(result.recall).toBe(0.5)
    expect(result.precision).toBe(0.5)
  })

  it('aggregates held recall, absent precision, and MRR', () => {
    const metrics = aggregateMetrics([
      scoreCase(heldCase, ['uksc-2021-3']),
      scoreCase(absentCase, ['noise']),
    ])
    expect(metrics.heldRecall).toBe(1)
    expect(metrics.absentPrecision).toBe(0)
    expect(metrics.mrr).toBe(1)
  })

  it('fails when the expected document drops in rank or falls out', () => {
    const current = baseline()
    const worseRank = scoreCase(heldCase, ['other', 'uksc-2021-3'])
    const dropped = scoreCase(heldCase, ['other'])
    expect(
      regressionFailures(current, aggregateMetrics([worseRank]), [
        worseRank,
      ]).some((failure) => failure.startsWith('rank_drop:party-example')),
    ).toBe(true)
    expect(
      regressionFailures(current, aggregateMetrics([dropped]), [dropped]).some(
        (failure) => failure.includes('rank_drop:party-example:0:absent'),
      ),
    ).toBe(true)
  })

  it('does not fail when a missing document appears or a rank improves', () => {
    const current = baseline({
      heldRecall: 0,
      mrr: 0,
      byQuery: {
        'party-example': { recall: 0, ranks: [null], returnedHitCount: 20 },
        'absent-example': { recall: null, ranks: [], returnedHitCount: 20 },
      },
    })
    const improved = scoreCase(heldCase, ['uksc-2021-3'])
    const quieter = scoreCase(absentCase, [])
    expect(
      regressionFailures(
        current,
        {
          caseCount: 2,
          heldRecall: 1,
          heldPrecision: 1,
          absentPrecision: 1,
          mrr: 1,
        },
        [improved, quieter],
      ),
    ).toEqual([])
  })

  it('ranks from a returned-id list as 1-based and null when absent', () => {
    expect(rankOf(['a', 'b'], 'b')).toBe(2)
    expect(rankOf(['a', 'b'], 'c')).toBe(null)
  })

  it('rounds to four decimal places', () => {
    expect(roundMetric(1 / 3)).toBe(0.3333)
  })
})
