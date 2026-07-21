import { describe, expect, it } from 'vitest'
import { scoreAdjudicatedDocuments } from './scoring'
import type { QaEvidence } from './qa'
import type { SyntheticDocument } from './types'

const document: SyntheticDocument = {
  id: 'doc-1',
  text: 'Alice',
  spans: [{ category: 'person_private', start: 0, end: 5, text: 'Alice' }],
  generator: 'fixture',
  specCell: 'fixture',
  matrixCells: [],
  contentHash: 'a'.repeat(64),
  hardNegatives: [],
}
const evidence: QaEvidence = {
  primary: {
    id: 'doc-1',
    allProposedSpansCorrect: true,
    hardNegativesCorrect: true,
    hardNegativeAssertions: [],
    referenceSpans: [],
    obviousUnmarkedSpans: [],
    realismScore: 5,
    confidence: 1,
    rationale: 'fixture',
  },
  escalationReasons: [],
  outcome: 'accepted',
  accepted: true,
  adjudicatedReference: {
    source: 'independent_judge_agreement',
    spans: [],
  },
}

describe('adjudicated scoring', () => {
  it('scores candidate spans against the independent reference instead of itself', () => {
    const score = scoreAdjudicatedDocuments(
      [document],
      new Map([[document.id, evidence]]),
      new Map([[document.id, document.spans]]),
      new Map([[document.id, document.spans]]),
    )
    expect(score.entity.overall.falsePositive).toBe(1)
    expect(score.entity.documentExactMatchRate).toBe(0)
  })

  it('keeps hard-negative FPR from the first annotation pass after repair', () => {
    const hardNegativeDocument = {
      ...document,
      text: 'Claim No. KB-2026-000123',
      spans: [],
      hardNegatives: [
        {
          id: 'claim',
          kind: 'claim_number' as const,
          quote: 'Claim No. KB-2026-000123',
          occurrence: 1,
          expectedCount: 1,
          mustNotOverlap: ['case_reference' as const],
        },
      ],
    }
    const score = scoreAdjudicatedDocuments(
      [hardNegativeDocument],
      new Map([[hardNegativeDocument.id, evidence]]),
      new Map([[hardNegativeDocument.id, hardNegativeDocument.spans]]),
      new Map([
        [
          hardNegativeDocument.id,
          [
            {
              category: 'case_reference',
              start: 0,
              end: hardNegativeDocument.text.length,
              text: hardNegativeDocument.text,
            },
          ],
        ],
      ]),
    )
    expect(score.hardNegatives.firstPass.falsePositiveRate).toBe(1)
    expect(score.hardNegatives.final.falsePositiveRate).toBe(0)
  })

  it('rejects an unadjudicated document', () => {
    const unadjudicated = { ...evidence, adjudicatedReference: undefined }
    expect(() =>
      scoreAdjudicatedDocuments(
        [document],
        new Map([[document.id, unadjudicated]]),
        new Map([[document.id, document.spans]]),
      ),
    ).toThrow('Missing independently adjudicated reference')
  })
})
