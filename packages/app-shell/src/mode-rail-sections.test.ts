import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type { VerificationRun } from '@obiter/contracts'
import { verificationRailSections } from './mode-rail-sections'

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
    startedAt: '2026-09-14T00:00:01.000Z',
    completedAt: '2026-09-14T00:00:02.000Z',
    summary: { findingCount: 0, flaggedCount: 0, reviewRequiredCount: 0 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

describe('verificationRailSections', () => {
  it('lists real runs instead of an "In development" placeholder', () => {
    const sections = verificationRailSections([
      run({
        id: 'vrun_review',
        summary: { findingCount: 2, flaggedCount: 0, reviewRequiredCount: 2 },
      }),
    ])
    const runs = sections.find((section) => section.title === 'Runs')
    expect(runs?.items.map((item) => item.label)).toEqual([
      'Review required (2)',
    ])
    expect(
      sections.some((section) =>
        section.items.some((item) => item.note === 'In development'),
      ),
    ).toBe(false)
  })

  it('never says "Nothing to review" when a completed run needs review', () => {
    const sections = verificationRailSections([
      run({
        id: 'vrun_review',
        summary: { findingCount: 2, flaggedCount: 0, reviewRequiredCount: 2 },
      }),
    ])
    const needsReview = sections.find(
      (section) => section.title === 'Needs review',
    )
    expect(needsReview?.items.map((item) => item.label)).toEqual([
      'Review required (2)',
    ])
    expect(
      needsReview?.items.some((item) => item.label === 'Nothing to review'),
    ).toBe(false)
  })

  it('surfaces a flagged completed run under Needs review', () => {
    const sections = verificationRailSections([
      run({
        id: 'vrun_flagged',
        summary: { findingCount: 3, flaggedCount: 2, reviewRequiredCount: 1 },
      }),
    ])
    const needsReview = sections.find(
      (section) => section.title === 'Needs review',
    )
    expect(needsReview?.items.map((item) => item.label)).toEqual([
      'Flagged findings (2)',
    ])
  })

  it('says "Nothing to review" only when completed runs are clear', () => {
    const sections = verificationRailSections([run()])
    const needsReview = sections.find(
      (section) => section.title === 'Needs review',
    )
    expect(needsReview?.items[0]?.label).toBe('Nothing to review')
  })

  it('points an empty rail at the document where a run starts', () => {
    const sections = verificationRailSections([])
    const runs = sections.find((section) => section.title === 'Runs')
    expect(runs?.items[0]).toMatchObject({
      label: 'No verification runs',
      note: 'Start one from a document',
      to: '/matters',
    })
  })
})
