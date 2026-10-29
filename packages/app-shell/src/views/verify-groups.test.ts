import { describe, expect, it } from 'bun:test'
import type {
  VerificationFindingView,
  VerificationRun,
} from '@obiter/contracts'
import { verificationFindingCounts } from '../verification-copy'
import {
  buildVerifyGroups,
  findingMatchesFilter,
  groupMatchesFilter,
  sortFindings,
  verifyFilterCounts,
} from './verify-groups'

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
    createdAt: '2026-10-26T09:00:00.000Z',
    startedAt: '2026-10-26T09:00:01.000Z',
    completedAt: '2026-10-26T09:02:00.000Z',
    summary: {
      findingCount: 3,
      flaggedCount: 1,
      reviewRequiredCount: 1,
      notCheckedCount: 1,
      dismissedCount: 0,
    },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

function finding(
  overrides: Partial<VerificationFindingView> = {},
): VerificationFindingView {
  return {
    id: 'vf_1',
    type: 'citation_resolution',
    state: 'clear',
    dismissal: null,
    reviewReason: null,
    severity: null,
    confidence: null,
    requiresReview: false,
    explanation: 'The citation resolved.',
    excerpt: '[2017] UKSC 24',
    location: { paragraphId: 'p1', start: 0, end: 13 },
    authorityLabel: '[2017] UKSC 24',
    authorityName: null,
    evidence: [],
    ...overrides,
  }
}

const matters = [
  { id: 'mtr_1', name: 'Northgate', clientReference: 'NGF-0418' },
  { id: 'mtr_2', name: 'Okafor', clientReference: 'OKA-0233' },
]

const identity = {
  status: 'available' as const,
  filename: 'advice.docx',
  currentVersionId: 'ver_1',
  currentVersionNumber: 1,
  versionNumbers: new Map([
    ['ver_1', 1],
    ['ver_2', 2],
  ]),
  ready: true,
}

describe('buildVerifyGroups', () => {
  it('groups by matter and then document, in the order the runs arrived', () => {
    const groups = buildVerifyGroups({
      runs: [
        run({ id: 'a', matterId: 'mtr_1', documentId: 'doc_1' }),
        run({ id: 'b', matterId: 'mtr_2', documentId: 'doc_2' }),
        run({ id: 'c', matterId: 'mtr_1', documentId: 'doc_3' }),
      ],
      matters,
      documents: new Map([
        ['doc_1', identity],
        ['doc_2', { ...identity, filename: 'statement.docx' }],
        ['doc_3', identity],
      ]),
    })
    expect(groups.map((group) => group.name)).toEqual(['Northgate', 'Okafor'])
    expect(groups[0]?.documents.map((doc) => doc.documentId)).toEqual([
      'doc_1',
      'doc_3',
    ])
    expect(groups[0]?.reference).toBe('NGF-0418')
  })

  it('shows the newest run state and the findings of the newest completed run', () => {
    const [group] = buildVerifyGroups({
      runs: [
        run({
          id: 'failed',
          status: 'failed',
          failureCode: 'execution_failed',
        }),
        run({ id: 'done', documentVersionId: 'ver_2', stale: true }),
      ],
      matters,
      documents: new Map([['doc_1', identity]]),
    })
    expect(group?.documents[0]?.run.id).toBe('failed')
    expect(group?.documents[0]?.findingsRun?.id).toBe('done')
    // A stale result is never presented as covering the stored version.
    expect(group?.documents[0]?.coversCurrentVersion).toBe(false)
  })

  it('names an unknown matter and a pending document lookup honestly', () => {
    const [group] = buildVerifyGroups({
      runs: [run({ matterId: 'mtr_missing' })],
      matters,
      documents: new Map(),
    })
    expect(group?.name).toBe('Matter unavailable')
    expect(group?.documents[0]?.identity.status).toBe('pending')
  })
})

describe('sortFindings', () => {
  // The list is read from the top: a possible error first, then what only a
  // person can judge, then the matches that need no reading.
  it('ranks flagged first, then review-required, then matches', () => {
    const matched = finding({
      id: 'clear',
      location: { paragraphId: 'p4', start: 40, end: 50 },
    })
    const review = finding({
      id: 'review',
      state: 'review_required',
      location: { paragraphId: 'p3', start: 30, end: 40 },
    })
    const flagged = finding({
      id: 'flagged',
      state: 'flagged',
      location: { paragraphId: 'p2', start: 20, end: 30 },
    })
    expect(
      sortFindings([matched, review, flagged]).map((item) => item.id),
    ).toEqual(['flagged', 'review', 'clear'])
  })

  // Two findings of one state keep the document's own order, so reading down
  // the list does not jump backwards and forwards through the file.
  it('keeps the document order inside one state', () => {
    const later = finding({
      id: 'later',
      state: 'flagged',
      location: { paragraphId: 'p2', start: 200, end: 210 },
    })
    const earlier = finding({
      id: 'earlier',
      state: 'flagged',
      location: { paragraphId: 'p1', start: 10, end: 20 },
    })
    expect(sortFindings([later, earlier]).map((item) => item.id)).toEqual([
      'earlier',
      'later',
    ])
  })
})

describe('verify filters', () => {
  const dismissed = finding({
    id: 'vf_dismissed',
    state: 'flagged',
    dismissal: {
      reason: 'Quoted directly.',
      dismissedBy: 'usr_1',
      dismissedByName: 'Priya Shah',
      dismissedAt: '2026-10-26T09:02:00.000Z',
    },
  })

  it('lists a dismissed finding only under All, keeping its outcome', () => {
    expect(findingMatchesFilter(dismissed, 'all')).toBe(true)
    expect(findingMatchesFilter(dismissed, 'flagged')).toBe(false)
    expect(verificationFindingCounts([dismissed]).flagged).toBe(1)
    expect(verificationFindingCounts([dismissed]).dismissed).toBe(1)
  })

  it('matches each state to its own filter', () => {
    expect(findingMatchesFilter(finding({ state: 'flagged' }), 'flagged')).toBe(
      true,
    )
    expect(
      findingMatchesFilter(
        finding({
          state: 'review_required',
          reviewReason: 'check_inconclusive',
        }),
        'review',
      ),
    ).toBe(true)
    expect(
      findingMatchesFilter(finding({ state: 'not_checked' }), 'unchecked'),
    ).toBe(true)
    expect(findingMatchesFilter(finding(), 'match')).toBe(true)
  })

  it('decides a document group from the run summary before findings load', () => {
    const [group] = buildVerifyGroups({
      runs: [run()],
      matters,
      documents: new Map([['doc_1', identity]]),
    })
    const document = group!.documents[0]!
    expect(groupMatchesFilter(document, 'flagged')).toBe(true)
    expect(groupMatchesFilter(document, 'review')).toBe(true)
    expect(groupMatchesFilter(document, 'unchecked')).toBe(true)
    expect(groupMatchesFilter(document, 'match')).toBe(false)
    expect(
      groupMatchesFilter({ ...document, findingsRun: null }, 'flagged'),
    ).toBe(false)
  })

  it('counts each filter across the shown results', () => {
    const groups = buildVerifyGroups({
      runs: [run(), run({ id: 'b', documentId: 'doc_2' })],
      matters,
      documents: new Map([
        ['doc_1', identity],
        ['doc_2', identity],
      ]),
    })
    expect(verifyFilterCounts(groups)).toEqual({
      all: 6,
      flagged: 2,
      review: 2,
      unchecked: 2,
      match: 0,
    })
  })
})
