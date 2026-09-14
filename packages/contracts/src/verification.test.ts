import { describe, expect, it } from 'vitest'
import {
  verificationFindingViewSchema,
  verificationRunCreateRequestSchema,
  verificationRunSchema,
} from './verification'

describe('verification contracts', () => {
  it('requires an explicit version id on create', () => {
    expect(verificationRunCreateRequestSchema.safeParse({}).success).toBe(false)
    expect(
      verificationRunCreateRequestSchema.parse({ versionId: 'ver_1' }),
    ).toEqual({ versionId: 'ver_1' })
  })

  it('marks a run stale only through the dedicated flag, not by retargeting', () => {
    const run = verificationRunSchema.parse({
      id: 'vrun_1',
      organisationId: 'org_1',
      matterId: 'mtr_1',
      documentId: 'doc_1',
      documentVersionId: 'ver_1',
      status: 'completed',
      failureCode: null,
      createdBy: 'usr_1',
      createdAt: '2026-09-14T00:00:00.000Z',
      startedAt: '2026-09-14T00:00:01.000Z',
      completedAt: '2026-09-14T00:00:02.000Z',
      summary: { findingCount: 0, flaggedCount: 0, reviewRequiredCount: 0 },
      documentCurrentVersionId: 'ver_2',
      stale: true,
    })
    expect(run.documentVersionId).toBe('ver_1')
    expect(run.stale).toBe(true)
  })

  it('refuses a finding view without an evidence identity label', () => {
    expect(
      verificationFindingViewSchema.safeParse({
        id: 'vf:1',
        type: 'quote_fidelity',
        state: 'clear',
        reviewReason: null,
        severity: null,
        confidence: 'high',
        requiresReview: false,
        explanation: 'Matched.',
        excerpt: 'the court must consider',
        location: { paragraphId: 'p1', start: 0, end: 23 },
        authorityLabel: '[2024] UKSC 1',
        evidence: [{ id: 'src:judgment_paragraph:1', sourceId: 'src' }],
      }).success,
    ).toBe(false)
  })
})
