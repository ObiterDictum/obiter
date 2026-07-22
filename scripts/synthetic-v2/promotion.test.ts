import { describe, expect, it } from 'vitest'
import {
  assertBenchmarkPromotion,
  assertCandidateEvidenceBinding,
  publicPromotionMetadata,
} from './promotion'
import { contentHash } from './validation'
import type { SyntheticDocument } from './types'

const candidateManifestHash = 'c'.repeat(64)
const document = {
  id: 'bench-1',
  text: 'Synthetic.',
  spans: [],
  generator: 'fixture',
  specCell: 'x',
  matrixCells: [],
  contentHash: contentHash('Synthetic.'),
} satisfies SyntheticDocument
const verdict = {
  id: 'bench-1',
  allProposedSpansCorrect: true,
  hardNegativesCorrect: true,
  hardNegativeAssertions: [],
  referenceSpans: [],
  obviousUnmarkedSpans: [],
  realismScore: 5,
  confidence: 1,
  rationale: 'ok',
}
const evidence = {
  candidateManifestHash,
  partitionRegistryHash: 'b'.repeat(64),
  judgeVerdicts: [verdict],
  disputeVerdicts: [],
  audits: [
    {
      id: 'bench-1',
      completed: true,
      reviewer: 'human reviewer',
      evidenceHash: 'a'.repeat(64),
    },
  ],
  approval: {
    approvedBy: 'human approver',
    approvedAt: '2026-07-20T12:00:00.000Z',
    termsReviewReference: 'terms-2026-07',
  },
}

describe('benchmark promotion', () => {
  it('fails closed without candidate binding, QA, and audit evidence', () => {
    expect(() =>
      assertBenchmarkPromotion([document], {
        ...evidence,
        candidateManifestHash: 'invalid',
      }),
    ).toThrow('invalid candidate manifest hash')
    expect(() =>
      assertBenchmarkPromotion([document], {
        ...evidence,
        judgeVerdicts: [],
      }),
    ).toThrow('Missing independent')
    expect(() =>
      assertBenchmarkPromotion([document], {
        ...evidence,
        audits: [],
      }),
    ).toThrow('completed audit')
  })

  it('accepts independently judged, bound, and audited documents', () => {
    expect(() => assertBenchmarkPromotion([document], evidence)).not.toThrow()
    expect(() =>
      assertCandidateEvidenceBinding('d'.repeat(64), evidence),
    ).toThrow('does not bind')
  })

  it('requires a hashed human disposition for a failed verdict', () => {
    const failed = { ...verdict, allProposedSpansCorrect: false }
    expect(() =>
      assertBenchmarkPromotion([document], {
        ...evidence,
        judgeVerdicts: [failed],
        disputeVerdicts: [verdict],
      }),
    ).toThrow('hashed human disposition')
    expect(() =>
      assertBenchmarkPromotion([document], {
        ...evidence,
        judgeVerdicts: [failed],
        disputeVerdicts: [verdict],
        humanDispositions: [
          {
            id: document.id,
            decision: 'approved',
            reviewer: 'human reviewer',
            adjudicatedAt: '2026-07-20T12:00:00.000Z',
            evidenceHash: 'd'.repeat(64),
          },
        ],
      }),
    ).not.toThrow()
  })

  it('rejects duplicate or foreign evidence IDs rather than silently replacing them', () => {
    expect(() =>
      assertBenchmarkPromotion([document], {
        ...evidence,
        judgeVerdicts: [verdict, verdict],
      }),
    ).toThrow('invalid independent QA verdict IDs')
    expect(() =>
      assertBenchmarkPromotion([document], {
        ...evidence,
        audits: [{ ...evidence.audits[0]!, id: 'foreign' }],
      }),
    ).toThrow('invalid audit IDs')
  })

  it('emits sanitised public metadata only', () => {
    const metadata = publicPromotionMetadata(candidateManifestHash, evidence)
    expect(metadata).toEqual({
      stage: 'benchmark',
      version: 'synthetic-v2-benchmark-promotion:v2',
      candidateManifestHash,
      partitionRegistryHash: evidence.partitionRegistryHash,
      promotionEvidenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      approvedAt: evidence.approval.approvedAt,
      termsReviewReference: evidence.approval.termsReviewReference,
    })
    expect(JSON.stringify(metadata)).not.toContain('human reviewer')
    expect(JSON.stringify(metadata)).not.toContain('human approver')
    expect(JSON.stringify(metadata)).not.toContain('rationale')
  })
})
