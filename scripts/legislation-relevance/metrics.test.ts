import { describe, expect, it } from 'vitest'
import type { LegislationRelevanceCase } from './cases'
import {
  aggregateMetrics,
  canonicalLegislationId,
  rankOf,
  regressionFailures,
  roundMetric,
  scoreCase,
  type LegislationRelevanceBaseline,
} from './metrics'

const exactCase: LegislationRelevanceCase = {
  id: 'section-example',
  kind: 'held',
  category: 'section_lookup',
  query: 's. 6 Human Rights Act 1998',
  expectedIds: ['ukpga/1998/42/section/6'],
  scoring: 'exact',
}

const subjectCase: LegislationRelevanceCase = {
  id: 'subject-example',
  kind: 'held',
  category: 'subject_matter',
  query: 'reasonable adjustments',
  expectedIds: ['ukpga/2010/15/section/20', 'ukpga/2010/15/section/21'],
  scoring: 'subject',
}

const absentCase: LegislationRelevanceCase = {
  id: 'absent-example',
  kind: 'absent',
  category: 'absent_act',
  query: 'Children Act 1989',
  expectedIds: [],
  scoring: 'exact',
  absentCheck: { kind: 'act_not_held', title: 'Children Act 1989' },
}

function baseline(
  overrides: Partial<LegislationRelevanceBaseline> = {},
): LegislationRelevanceBaseline {
  return {
    expectedCaseCount: 2,
    expectedIndexDocumentCount: 184772,
    heldRecall: 1,
    heldPrecision: 1,
    absentPrecision: 0,
    mrr: 1,
    heldNotHeldViolations: 0,
    byQuery: {
      'section-example': { recall: 1, ranks: [1], returnedHitCount: 1 },
      'absent-example': { recall: null, ranks: [], returnedHitCount: 5 },
    },
    ...overrides,
  }
}

describe('legislation relevance metrics', () => {
  it('builds the canonical identity from the retrieval-stable fields', () => {
    // Keyword hits carry an engine id and a label path; exact hits carry a
    // slashed id. Both serve documentIdentity and labelPath, so scoring reads
    // those and the retrieval path cannot move a score.
    expect(
      canonicalLegislationId({
        documentIdentity: 'ukpga/2010/15',
        labelPath: 'section/20',
      }),
    ).toBe('ukpga/2010/15/section/20')
    expect(
      canonicalLegislationId({
        documentIdentity: 'ukpga/1998/42',
        labelPath: '',
      }),
    ).toBe('ukpga/1998/42')
    expect(canonicalLegislationId({})).toBe('')
  })

  it('reports the 1-based rank of an exact expected provision', () => {
    expect(
      rankOf(
        ['other', 'ukpga/1998/42/section/6'],
        'ukpga/1998/42/section/6',
        'exact',
      ),
    ).toBe(2)
    expect(rankOf(['other'], 'ukpga/1998/42/section/6', 'exact')).toBe(null)
  })

  it('matches a subject expectation by subtree so a subsection answers', () => {
    expect(
      rankOf(
        ['ukpga/2010/15/section/20/3'],
        'ukpga/2010/15/section/20',
        'subject',
      ),
    ).toBe(1)
    // Exact lookups name one entity: a subsection is a different provision.
    expect(
      rankOf(
        ['ukpga/2010/15/section/20/3'],
        'ukpga/2010/15/section/20',
        'exact',
      ),
    ).toBe(null)
  })

  it('scores an exact held case for recall, precision, and MRR', () => {
    const result = scoreCase(exactCase, ['ukpga/1998/42/section/6'])
    expect(result.ranks).toEqual([1])
    expect(result.recall).toBe(1)
    expect(result.precision).toBe(1)
    expect(result.mrr).toBe(1)
    expect(result.failureLabels).toEqual([])
  })

  it('counts a stray served provision as an exact false positive', () => {
    const result = scoreCase(exactCase, [
      'ukpga/1998/42/schedule/1/paragraph/1',
      'ukpga/1998/42/section/6',
    ])
    expect(result.recall).toBe(1)
    expect(result.precision).toBe(0.5)
    expect(result.mrr).toBe(0.5)
    expect(result.failureLabels).toEqual([])
  })

  it('treats a held provision missing from the served group as recall 0', () => {
    const result = scoreCase(exactCase, ['other'])
    expect(result.ranks).toEqual([null])
    expect(result.recall).toBe(0)
    expect(result.mrr).toBe(0)
    expect(result.failureLabels).toEqual(['held_miss'])
  })

  it('leaves precision unscored for subject cases', () => {
    const result = scoreCase(subjectCase, [
      'ukpga/2010/15/section/20/3',
      'ukpga/2010/15/section/103',
    ])
    expect(result.recall).toBe(0.5)
    expect(result.precision).toBe(null)
    expect(result.mrr).toBe(1)
  })

  it('scores absent queries as precision 1 only when nothing is served', () => {
    expect(scoreCase(absentCase, []).precision).toBe(1)
    const noisy = scoreCase(absentCase, ['ukpga/2026/21/section/12'])
    expect(noisy.precision).toBe(0)
    expect(noisy.failureLabels).toEqual(['absent_hits'])
  })

  it('aggregates the four headline metrics with the exact/subject split', () => {
    const metrics = aggregateMetrics([
      scoreCase(exactCase, ['ukpga/1998/42/section/6']),
      scoreCase(subjectCase, ['ukpga/2010/15/section/20/3']),
      scoreCase(absentCase, ['noise']),
    ])
    expect(metrics.heldRecall).toBe(0.75)
    expect(metrics.heldPrecision).toBe(1)
    expect(metrics.absentPrecision).toBe(0)
    expect(metrics.mrr).toBe(1)
    expect(metrics.exactHeldRecall).toBe(1)
    expect(metrics.subjectRecall).toBe(0.5)
  })

  it('fails when an expected provision drops in rank or falls out', () => {
    const current = baseline()
    const worseRank = scoreCase(exactCase, ['other', 'ukpga/1998/42/section/6'])
    const dropped = scoreCase(exactCase, ['other'])
    expect(
      regressionFailures(current, aggregateMetrics([worseRank]), [
        worseRank,
      ]).some((failure) => failure.startsWith('rank_drop:section-example')),
    ).toBe(true)
    expect(
      regressionFailures(current, aggregateMetrics([dropped]), [dropped]).some(
        (failure) => failure.includes('rank_drop:section-example:0:absent'),
      ),
    ).toBe(true)
  })

  it('fails when an absent query starts serving more noise', () => {
    const current = baseline()
    const noisier = scoreCase(absentCase, ['a', 'b', 'c', 'd', 'e', 'f'])
    expect(
      regressionFailures(current, aggregateMetrics([noisier]), [noisier]).some(
        (failure) => failure.startsWith('absent_hits_up:absent-example'),
      ),
    ).toBe(true)
  })

  it('does not fail when a missing provision appears or an absent query quietens', () => {
    const current = baseline({
      heldRecall: 0,
      heldPrecision: 0,
      mrr: 0,
      byQuery: {
        'section-example': { recall: 0, ranks: [null], returnedHitCount: 5 },
        'absent-example': { recall: null, ranks: [], returnedHitCount: 5 },
      },
    })
    const improved = scoreCase(exactCase, ['ukpga/1998/42/section/6'])
    const quieter = scoreCase(absentCase, [])
    expect(
      regressionFailures(current, aggregateMetrics([improved, quieter]), [
        improved,
        quieter,
      ]),
    ).toEqual([])
  })

  it('fails the invariant when a held case reports a not-held verdict', () => {
    const current = baseline()
    const falseNotHeld = scoreCase(exactCase, ['ukpga/1998/42/section/6'], {
      legislationNotHeld: true,
    })
    expect(falseNotHeld.failureLabels).toContain('held_false_not_held')
    expect(
      regressionFailures(current, aggregateMetrics([falseNotHeld]), [
        falseNotHeld,
      ]).some((failure) => failure.startsWith('false_not_held:')),
    ).toBe(true)
  })

  it('scores a control query as a negative, never for hits', () => {
    const controlCase: LegislationRelevanceCase = {
      id: 'control-example',
      kind: 'control',
      category: 'subject_matter',
      query: 'defences under the Children Act 1989',
      expectedIds: [],
      scoring: 'exact',
    }
    const clean = scoreCase(controlCase, ['serve anything'])
    expect(clean.recall).toBe(null)
    expect(clean.precision).toBe(null)
    expect(clean.failureLabels).toEqual([])
    const claimed = scoreCase(controlCase, [], { legislationNotHeld: true })
    expect(claimed.failureLabels).toContain('control_false_not_held')
    const unresolved = scoreCase(controlCase, [], {
      legislationTitleUnresolved: true,
    })
    expect(unresolved.failureLabels).toContain('control_title_unresolved')
  })

  it('rounds to four decimal places', () => {
    expect(roundMetric(1 / 3)).toBe(0.3333)
  })
})
