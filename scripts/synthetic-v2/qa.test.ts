import { describe, expect, it } from 'vitest'
import {
  evaluateIndependentReference,
  judgePrompt,
  parseIndependentJudgeReference,
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

  it('does not treat a wrong-category containing span as covered', () => {
    expect(
      supplementMisses([
        {
          ...document,
          spans: [
            {
              category: 'person_private',
              start: 8,
              end: 25,
              text: 'alex@example.test',
            },
          ],
        },
      ]),
    ).toMatchObject([{ category: 'email', text: 'alex@example.test' }])
  })

  it('creates text-only quote-occurrence references and resolves repeats locally', () => {
    const repeated = {
      ...document,
      text: 'Alex met Alex at the fictional hearing.',
      spans: [],
    }
    const prompt = judgePrompt(repeated)
    expect(prompt).not.toContain('Proposed spans')
    expect(prompt).not.toContain(JSON.stringify(repeated.spans))
    const reference = parseIndependentJudgeReference(
      JSON.stringify({
        id: repeated.id,
        referenceSpans: [
          { category: 'person_private', quote: 'Alex', occurrence: 2 },
        ],
        realismScore: 5,
        confidence: 1,
        rationale: 'fictional',
      }),
      repeated.id,
      repeated,
    )
    expect(
      evaluateIndependentReference(repeated, reference).referenceSpans,
    ).toEqual([{ category: 'person_private', start: 9, end: 13, text: 'Alex' }])
    expect(() =>
      parseIndependentJudgeReference(
        JSON.stringify({
          ...reference,
          referenceSpans: [
            { category: 'person_private', quote: 'Absent', occurrence: 1 },
          ],
        }),
        repeated.id,
        repeated,
      ),
    ).toThrow('absent or ambiguous')
  })

  it('rejects a low-confidence or incomplete automated judgement', () => {
    const verdict = parseJudgeVerdict(
      JSON.stringify({
        id: 'qa-1',
        allProposedSpansCorrect: true,
        hardNegativesCorrect: true,
        hardNegativeAssertions: [],
        referenceSpans: [],
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
    expect(qaSample(documents)).toHaveLength(3)
  })
})
