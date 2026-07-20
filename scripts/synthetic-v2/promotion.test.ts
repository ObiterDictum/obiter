import { describe, expect, it } from 'vitest'
import { assertBenchmarkPromotion } from './promotion'
import type { SyntheticDocument } from './types'

const document = {
  id: 'bench-1',
  text: 'Synthetic.',
  spans: [],
  generator: 'fixture',
  specCell: 'x',
  matrixCells: [],
  contentHash: 'x',
} satisfies SyntheticDocument
const verdict = {
  id: 'bench-1',
  allProposedSpansCorrect: true,
  hardNegativesCorrect: true,
  obviousUnmarkedSpans: [],
  realismScore: 5,
  confidence: 1,
  rationale: 'ok',
}

describe('benchmark promotion', () => {
  it('fails closed without QA and audit evidence', () => {
    expect(() =>
      assertBenchmarkPromotion([document], {
        judgeVerdicts: [],
        disputeVerdicts: [],
        audits: [],
      }),
    ).toThrow('Missing independent')
    expect(() =>
      assertBenchmarkPromotion([document], {
        judgeVerdicts: [verdict],
        disputeVerdicts: [],
        audits: [],
      }),
    ).toThrow('completed audits')
  })
  it('accepts independently judged and audited documents', () => {
    expect(() =>
      assertBenchmarkPromotion([document], {
        judgeVerdicts: [verdict],
        disputeVerdicts: [],
        audits: [{ id: 'bench-1', completed: true, reviewer: 'human' }],
      }),
    ).not.toThrow()
  })
})
