import { describe, expect, it } from 'vitest'
import { reviewDocuments } from './qa'
import { assertBenchmarkPromotion } from './promotion'
import type { JudgeAdapter, SyntheticDocument } from './types'

const document: SyntheticDocument = {
  id: 'doc-1',
  text: 'Fictional.',
  spans: [],
  generator: 'fake',
  specCell: 'x',
  matrixCells: [],
  contentHash: 'a'.repeat(64),
  hardNegatives: [],
}
const good = JSON.stringify({
  id: 'doc-1',
  allProposedSpansCorrect: true,
  hardNegativesCorrect: true,
  obviousUnmarkedSpans: [],
  realismScore: 5,
  confidence: 1,
  rationale: 'ok',
})
const bad = JSON.stringify({
  id: 'doc-1',
  allProposedSpansCorrect: false,
  hardNegativesCorrect: false,
  obviousUnmarkedSpans: [],
  realismScore: 1,
  confidence: 0.1,
  rationale: 'bad',
})
function judge(verdict: string): JudgeAdapter {
  return {
    name: 'fake-judge',
    judge: async (documents) =>
      documents.map((entry) => ({ id: entry.id, verdict })),
  }
}

describe('independent QA execution gates', () => {
  it('does not accept a failed primary and requires second judge for escalations', async () => {
    const evidence = await reviewDocuments([document], judge(bad), judge(good))
    expect(evidence.get(document.id)?.accepted).toBe(false)
    expect(() =>
      assertBenchmarkPromotion([document], {
        judgeVerdicts: [],
        disputeVerdicts: [],
        audits: [],
      }),
    ).toThrow('Missing independent')
  })
  it('persists second-judge evidence for protected/hard-negative escalation', async () => {
    const protectedDocument = {
      ...document,
      spans: [
        { category: 'person_protected' as const, start: 0, end: 1, text: 'F' },
      ],
    }
    const evidence = await reviewDocuments(
      [protectedDocument],
      judge(good),
      judge(good),
    )
    expect(evidence.get(document.id)?.dispute).toBeDefined()
  })
})
