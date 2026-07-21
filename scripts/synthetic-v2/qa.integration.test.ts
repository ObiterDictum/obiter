import { describe, expect, it } from 'vitest'
import {
  applyAdjudicatedReference,
  humanAdjudicationEvidenceHash,
  reviewDocuments,
} from './qa'
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
  hardNegativeAssertions: [],
  referenceSpans: [],
  obviousUnmarkedSpans: [],
  realismScore: 5,
  confidence: 1,
  rationale: 'ok',
})
const bad = JSON.stringify({
  id: 'doc-1',
  allProposedSpansCorrect: false,
  hardNegativesCorrect: false,
  hardNegativeAssertions: [],
  referenceSpans: [],
  obviousUnmarkedSpans: [],
  realismScore: 1,
  confidence: 0.1,
  rationale: 'bad',
})
function judge(verdict: string, model: string): JudgeAdapter {
  return {
    name: `fake:${model}`,
    model,
    maxChargeAttempts: 1,
    judge: async (documents) =>
      documents.map((entry) => ({ id: entry.id, verdict })),
  }
}

describe('independent QA execution gates', () => {
  it('does not accept a failed primary and requires second judge for escalations', async () => {
    const evidence = await reviewDocuments(
      [document],
      judge(bad, 'primary'),
      judge(good, 'dispute'),
    )
    expect(evidence.get(document.id)?.accepted).toBe(false)
    expect(() =>
      assertBenchmarkPromotion([document], {
        candidateManifestHash: 'a'.repeat(64),
        judgeVerdicts: [],
        disputeVerdicts: [],
        audits: [],
      }),
    ).toThrow('Missing independent')
  })
  it('holds reference disagreement for human adjudication rather than accepting it', async () => {
    const conflicting = JSON.stringify({
      id: 'doc-1',
      allProposedSpansCorrect: true,
      hardNegativesCorrect: true,
      hardNegativeAssertions: [],
      referenceSpans: [
        { category: 'person_private', start: 0, end: 9, text: 'Fictional' },
      ],
      obviousUnmarkedSpans: [],
      realismScore: 5,
      confidence: 1,
      rationale: 'different independent reference',
    })
    const evidence = await reviewDocuments(
      [document],
      judge(good, 'primary'),
      judge(conflicting, 'dispute'),
      undefined,
      { requireIndependentAdjudication: true },
    )
    expect(evidence.get(document.id)?.outcome).toBe(
      'human_adjudication_required',
    )
  })

  it('rejects stale human dispositions and releases the human reference exactly', async () => {
    const conflicting = JSON.stringify({
      ...JSON.parse(good),
      referenceSpans: [
        { category: 'person_private', start: 0, end: 9, text: 'Fictional' },
      ],
    })
    const primary = judge(good, 'primary')
    const dispute = judge(conflicting, 'dispute')
    const first = JSON.parse(good)
    const second = JSON.parse(conflicting)
    const adjudication = {
      id: document.id,
      decision: 'approved' as const,
      reviewer: 'reviewer',
      adjudicatedAt: '2026-07-20T12:00:00.000Z',
      rationale: 'reviewed',
      referenceSpans: second.referenceSpans,
      evidenceHash: humanAdjudicationEvidenceHash(document, first, second),
    }
    const evidence = await reviewDocuments(
      [document],
      primary,
      dispute,
      undefined,
      {
        requireIndependentAdjudication: true,
        humanAdjudications: new Map([[document.id, adjudication]]),
      },
    )
    const accepted = evidence.get(document.id)!
    expect(accepted.outcome).toBe('accepted')
    expect(applyAdjudicatedReference(document, accepted).spans).toEqual(
      adjudication.referenceSpans,
    )
    await expect(
      reviewDocuments([document], primary, dispute, undefined, {
        requireIndependentAdjudication: true,
        humanAdjudications: new Map([
          [document.id, { ...adjudication, evidenceHash: 'a'.repeat(64) }],
        ]),
      }),
    ).rejects.toThrow('stale or invalid')
  })

  it('preserves judge retry telemetry for spend and provenance accounting', async () => {
    const retryTelemetry = {
      requestId: 'retry-1',
      specId: document.id,
      role: 'primary_judge' as const,
      provider: 'fake',
      requestedModel: 'primary',
      returnedModel: 'primary',
      usage: { inputTokens: 2, outputTokens: 3 },
      latencyMs: 1,
      status: 'error' as const,
      attempt: 1,
      errorCode: 'judge_span_overlap',
    }
    const primary: JudgeAdapter = {
      name: 'fake:primary',
      model: 'primary',
      maxChargeAttempts: 2,
      judge: async (documents) =>
        documents.map((entry) => ({
          id: entry.id,
          verdict: good,
          retryTelemetry: [retryTelemetry],
        })),
    }
    const evidence = await reviewDocuments(
      [document],
      primary,
      judge(good, 'dispute'),
    )
    expect(evidence.get(document.id)?.primaryRetryTelemetry).toEqual([
      retryTelemetry,
    ])
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
      judge(good, 'primary'),
      judge(good, 'dispute'),
    )
    expect(evidence.get(document.id)?.dispute).toBeDefined()
  })
})
