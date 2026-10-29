import { describe, expect, it } from 'bun:test'
import type {
  VerificationFindingView,
  VerificationRun,
} from '@obiter/contracts'
import {
  formatRunTime,
  verificationAuthority,
  verificationCountsLabel,
  verificationDismissalRecord,
  verificationFindingCounts,
  verificationRunTime,
  verificationStateLabel,
  verificationSummaryCounts,
  verificationTypeLabel,
  verificationUncertainty,
} from './verification-copy'

function finding(
  overrides: Partial<VerificationFindingView> = {},
): VerificationFindingView {
  return {
    id: 'vf:1',
    type: 'citation_resolution',
    state: 'clear',
    dismissal: null,
    reviewReason: null,
    severity: null,
    confidence: null,
    requiresReview: false,
    explanation: 'The citation resolved to one stored authority.',
    excerpt: '[2017] UKSC 24',
    location: { paragraphId: 'p1', start: 0, end: 13 },
    authorityLabel: '[2017] UKSC 24',
    authorityName: null,
    evidence: [],
    ...overrides,
  }
}

describe('finding state wording', () => {
  it('never uses internal discriminant names as user copy', () => {
    expect(verificationTypeLabel('authority_existence')).toBe('Authority')
    expect(verificationStateLabel(finding())).toBe(
      'Citation matches checked source',
    )
    expect(verificationUncertainty(finding())).toBeNull()
    expect(verificationUncertainty(finding()) ?? '').not.toContain(
      'review_required',
    )
  })

  it('claims a match for a quotation only when the quotation check ran', () => {
    expect(
      verificationStateLabel(
        finding({ type: 'quote_fidelity', state: 'clear' }),
      ),
    ).toBe('Quotation matches checked source')
    expect(
      verificationStateLabel(
        finding({ type: 'authority_existence', state: 'clear' }),
      ),
    ).toBe('Authority is held in the stored sources')
  })

  // A finding that needs review states its limit once, in the explanation the
  // check wrote; a second sentence saying the same thing was noise on the card.
  it('adds no second sentence to a finding that needs review', () => {
    for (const reviewReason of [
      'citation_unresolved',
      'authority_not_held',
      'evidence_unavailable',
      'check_inconclusive',
      'citation_ambiguous',
    ] as const) {
      expect(
        verificationUncertainty(
          finding({ state: 'review_required', reviewReason }),
        ),
      ).toBeNull()
    }
  })

  it('names an authority by its stored case name, never by its citation alone', () => {
    expect(
      verificationAuthority({
        authorityLabel: '[2017] UKSC 24',
        authorityName: 'Wood v Capita Insurance Services Ltd',
      }),
    ).toBe('Wood v Capita Insurance Services Ltd [2017] UKSC 24')
    // No stored title: the citation is shown alone rather than a name invented.
    expect(
      verificationAuthority({
        authorityLabel: '[2099] UKSC 9',
        authorityName: null,
      }),
    ).toBe('[2099] UKSC 9')
  })

  it('says a check that did not run compared nothing', () => {
    expect(
      verificationUncertainty(
        finding({ state: 'not_checked', reviewReason: null }),
      ),
    ).toBe('This check did not run, so nothing was compared.')
  })

  it('keeps the counts apart, including dismissed findings', () => {
    const counts = verificationFindingCounts([
      finding({ id: 'a', state: 'flagged' }),
      finding({
        id: 'b',
        state: 'review_required',
        reviewReason: 'check_inconclusive',
      }),
      finding({ id: 'c', state: 'not_checked' }),
      finding({ id: 'd' }),
      finding({
        id: 'e',
        state: 'flagged',
        dismissal: {
          reason: 'Quoted directly from the judgment.',
          dismissedBy: 'usr_1',
          dismissedByName: 'Priya Shah',
          dismissedAt: '2026-10-26T14:52:00.000Z',
        },
      }),
    ])
    expect(counts).toEqual({
      flagged: 2,
      needsReview: 1,
      notChecked: 1,
      matched: 1,
      dismissed: 1,
      total: 5,
    })
    expect(verificationCountsLabel(counts)).toBe(
      '2 flagged · 1 needs review · 1 not checked · 1 matches the checked source · 1 dismissed',
    )
  })

  it('counts a run summary the same way it counts findings', () => {
    expect(
      verificationSummaryCounts({
        findingCount: 11,
        flaggedCount: 1,
        reviewRequiredCount: 2,
        notCheckedCount: 1,
        dismissedCount: 1,
      }),
    ).toMatchObject({
      flagged: 1,
      needsReview: 2,
      notChecked: 1,
      matched: 6,
      dismissed: 1,
    })
  })

  it('records who dismissed a finding and when, without inventing a name', () => {
    const dismissal = {
      reason: null,
      dismissedBy: 'usr_1',
      dismissedByName: 'Priya Shah',
      dismissedAt: '2026-10-26T14:52:00.000Z',
    }
    expect(verificationDismissalRecord(dismissal, 'usr_1')).toBe(
      `Dismissed by you · ${formatRunTime(dismissal.dismissedAt)}`,
    )
    // A colleague reads the decider's name, not "another reviewer".
    expect(verificationDismissalRecord(dismissal, 'usr_2')).toBe(
      `Dismissed by Priya Shah · ${formatRunTime(dismissal.dismissedAt)}`,
    )
    // A name the organisation no longer holds is not replaced by an id or a guess.
    expect(
      verificationDismissalRecord(
        { ...dismissal, dismissedByName: null },
        'usr_2',
      ),
    ).toBe(
      `Dismissed by another reviewer · ${formatRunTime(dismissal.dismissedAt)}`,
    )
  })
})

function run(overrides: Partial<VerificationRun> = {}): VerificationRun {
  return {
    id: 'vrun_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-09-14T00:00:00.000Z',
    startedAt: '2026-09-14T01:00:00.000Z',
    completedAt: '2026-09-14T02:00:00.000Z',
    summary: {
      findingCount: 0,
      flaggedCount: 0,
      reviewRequiredCount: 0,
      notCheckedCount: 0,
      dismissedCount: 0,
    },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

describe('verificationRunTime', () => {
  it('labels a completed run with its completion time', () => {
    expect(verificationRunTime(run())).toBe(
      `Completed ${formatRunTime('2026-09-14T02:00:00.000Z')}`,
    )
  })

  it('labels a failed run with when the failure was recorded, not when it was requested', () => {
    const label = verificationRunTime(
      run({ status: 'failed', failureCode: 'execution_failed' }),
    )
    expect(label).toBe(`Stopped ${formatRunTime('2026-09-14T02:00:00.000Z')}`)
    expect(label).not.toContain(formatRunTime('2026-09-14T00:00:00.000Z'))
  })

  it('labels a running run with when it started', () => {
    expect(verificationRunTime(run({ status: 'running' }))).toBe(
      `Started ${formatRunTime('2026-09-14T01:00:00.000Z')}`,
    )
  })

  it('labels a queued run with when it was created', () => {
    expect(
      verificationRunTime(run({ status: 'queued', startedAt: null })),
    ).toBe(`Created ${formatRunTime('2026-09-14T00:00:00.000Z')}`)
  })

  it('falls back to the creation time when a terminal run has no completion time', () => {
    expect(
      verificationRunTime(run({ status: 'failed', completedAt: null })),
    ).toBe(`Created ${formatRunTime('2026-09-14T00:00:00.000Z')}`)
  })
})
