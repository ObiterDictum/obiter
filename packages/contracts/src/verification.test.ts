import { describe, expect, it } from 'bun:test'
import {
  verificationFailureCodeSchema,
  verificationFindingViewSchema,
  verificationRunCreateRequestSchema,
  verificationRunListResponseSchema,
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
      summary: {
        findingCount: 0,
        flaggedCount: 0,
        reviewRequiredCount: 0,
        notCheckedCount: 0,
        dismissedCount: 0,
      },
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
        authorityName: null,
        evidence: [{ id: 'src:judgment_paragraph:1', sourceId: 'src' }],
      }).success,
    ).toBe(false)
    // The view also refuses evidence with no source location block: a finding
    // whose evidence cannot be opened is not a complete evidence view.
    expect(
      verificationFindingViewSchema.safeParse({
        id: 'vf:1',
        type: 'quote_fidelity',
        state: 'clear',
        dismissal: null,
        reviewReason: null,
        severity: null,
        confidence: 'high',
        requiresReview: false,
        explanation: 'Matched.',
        excerpt: 'the court must consider',
        location: { paragraphId: 'p1', start: 0, end: 23 },
        authorityLabel: '[2024] UKSC 1',
        authorityName: null,
        evidence: [
          {
            id: 'src:judgment_paragraph:1',
            sourceId: 'src',
            label: 'Judgment src, paragraph 1',
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('records an interrupted execution as its own failure code', () => {
    expect(verificationFailureCodeSchema.parse('interrupted')).toBe(
      'interrupted',
    )
  })

  it('carries story identity on a finding location', () => {
    const parsed = verificationFindingViewSchema.parse({
      id: 'vf:1',
      type: 'quote_fidelity',
      state: 'review_required',
      reviewReason: 'citation_ambiguous',
      severity: null,
      confidence: null,
      requiresReview: true,
      explanation: 'No single citation could be shown to own the quotation.',
      excerpt: 'the court must consider',
      location: {
        paragraphId: 'p1',
        storyKind: 'footnotes',
        storyPartName: 'word/footnotes.xml',
        start: 0,
        end: 23,
      },
      authorityLabel: 'Unresolved citation',
      authorityName: null,
      dismissal: null,
      evidence: [],
    })
    expect(parsed.location.storyKind).toBe('footnotes')
    expect(
      verificationFindingViewSchema.safeParse({
        ...parsed,
        location: { ...parsed.location, storyKind: 'not-a-story' },
      }).success,
    ).toBe(false)
  })

  it('carries a dismissal as a decision beside the finding outcome', () => {
    const parsed = verificationFindingViewSchema.parse({
      id: 'vf:1',
      type: 'citation_resolution',
      state: 'review_required',
      dismissal: {
        reason: 'The paragraph quotes the judgment directly.',
        dismissedBy: 'usr_1',
        dismissedByName: 'Priya Shah',
        dismissedAt: '2026-10-26T14:52:00.000Z',
      },
      reviewReason: 'citation_unresolved',
      severity: null,
      confidence: null,
      requiresReview: true,
      explanation: 'The citation did not resolve.',
      excerpt: '[2099] UKSC 9',
      location: { paragraphId: 'p1', start: 0, end: 13 },
      authorityLabel: 'Unmatched citation',
      authorityName: null,
      evidence: [],
    })
    expect(parsed.dismissal?.dismissedBy).toBe('usr_1')
    // A dismissal never rewrites what the check found.
    expect(parsed.state).toBe('review_required')
    expect(
      verificationFindingViewSchema.safeParse({
        ...parsed,
        dismissal: undefined,
      }).success,
    ).toBe(false)
  })

  it('requires an explicit next cursor on a run list page', () => {
    const empty = verificationRunListResponseSchema.parse({
      runs: [],
      nextCursor: null,
    })
    expect(empty.runs).toEqual([])
    expect(empty.nextCursor).toBeNull()
    expect(
      verificationRunListResponseSchema.safeParse({ runs: [] }).success,
    ).toBe(false)
  })
})
