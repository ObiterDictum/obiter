import { describe, expect, it } from 'vitest'
import {
  judgePrompt,
  parseJudgeVerdict,
  qaSample,
  requiresRegeneration,
  supplementMisses,
} from './qa'
import type { SyntheticDocument } from './types'

const document: SyntheticDocument = {
  id: 'qa-1',
  text: 'Contact alex@example.test before the deadline.',
  spans: [],
  generator: 'fixture',
  specCell: 'fixture',
  matrixCells: [],
  contentHash: 'fixture',
}

describe('mechanical QA', () => {
  it('reports supplement-detectable unlabelled PII', () => {
    expect(supplementMisses([document])).toMatchObject([
      { id: 'qa-1', category: 'email', text: 'alex@example.test' },
    ])
  })

  it('rejects a low-confidence or incomplete automated judgement', () => {
    const verdict = parseJudgeVerdict(
      JSON.stringify({
        id: 'qa-1',
        allProposedSpansCorrect: true,
        hardNegativesCorrect: true,
        obviousUnmarkedSpans: [],
        realismScore: 5,
        confidence: 0.79,
        rationale: 'Insufficient confidence.',
      }),
      'qa-1',
    )
    expect(requiresRegeneration(verdict)).toBe(true)
    expect(judgePrompt(document)).toContain('person_professional')
  })

  it('samples at least ten percent', () => {
    const documents = Array.from({ length: 20 }, (_, index) => ({
      ...document,
      id: `qa-${index}`,
    }))
    expect(qaSample(documents)).toHaveLength(2)
  })
})
