import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type { VerificationRun } from '@obiter/contracts'
import { latestRunsPerDocument, openWorkCount } from './open-work'
import { buildAttentionItems, summariseAttention } from './views/home-attention'

function run(overrides: Partial<VerificationRun> = {}): VerificationRun {
  return {
    id: 'vrun_old',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-10-01T09:00:00.000Z',
    startedAt: '2026-10-01T09:00:01.000Z',
    completedAt: '2026-10-01T09:00:02.000Z',
    summary: {
      findingCount: 3,
      flaggedCount: 2,
      reviewRequiredCount: 1,
      notCheckedCount: 0,
      dismissedCount: 0,
    },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

function items(sources: {
  verificationRuns: VerificationRun[]
  redactionRuns?: []
}) {
  return buildAttentionItems({
    verificationRuns: sources.verificationRuns,
    redactionRuns: sources.redactionRuns ?? [],
    documentFilenames: new Map(),
    matters: new Map(),
  })
}

describe('open work', () => {
  // The sidebar said 9 while Home said 6 because one counted re-runs and the
  // other counted runs. A document is checked once, however often it was run.
  it('counts one document once, from its newest run', () => {
    const older = run({ id: 'vrun_older', createdAt: '2026-10-01T09:00:00Z' })
    const newer = run({
      id: 'vrun_newer',
      createdAt: '2026-10-28T09:00:00Z',
      completedAt: '2026-10-28T09:00:02Z',
      summary: {
        findingCount: 1,
        flaggedCount: 0,
        reviewRequiredCount: 1,
        notCheckedCount: 0,
        dismissedCount: 0,
      },
    })
    // Newest first, as the API sends them.
    const runs = [newer, older]
    expect(latestRunsPerDocument(runs)).toEqual([newer])
    expect(
      openWorkCount({ verificationRuns: runs, redactionRuns: [] }),
    ).toEqual({ verify: 1, redact: 0, total: 1 })
    expect(items({ verificationRuns: runs })).toHaveLength(1)
  })

  it('stops counting a finding a person has dismissed', () => {
    // The run summary already reports a dismissed finding apart from its open
    // counts, so the rule must not add it back.
    const dismissed = run({
      id: 'vrun_dismissed',
      summary: {
        findingCount: 3,
        flaggedCount: 0,
        reviewRequiredCount: 1,
        notCheckedCount: 0,
        dismissedCount: 2,
      },
    })
    expect(
      openWorkCount({ verificationRuns: [dismissed], redactionRuns: [] })
        .verify,
    ).toBe(1)
  })

  it('counts a run bound to an earlier version, because it is still unread', () => {
    const stale = run({
      id: 'vrun_stale',
      stale: true,
      documentCurrentVersionId: 'ver_2',
      summary: {
        findingCount: 2,
        flaggedCount: 1,
        reviewRequiredCount: 1,
        notCheckedCount: 0,
        dismissedCount: 0,
      },
    })
    expect(
      openWorkCount({ verificationRuns: [stale], redactionRuns: [] }).verify,
    ).toBe(2)
  })

  it('counts a stopped run once, and a run still going not at all', () => {
    const stopped = run({
      id: 'vrun_stopped',
      status: 'failed',
      summary: {
        findingCount: 0,
        flaggedCount: 0,
        reviewRequiredCount: 0,
        notCheckedCount: 0,
        dismissedCount: 0,
      },
    })
    expect(
      openWorkCount({ verificationRuns: [stopped], redactionRuns: [] }).verify,
    ).toBe(1)
    expect(
      openWorkCount({
        verificationRuns: [run({ id: 'vrun_live', status: 'running' })],
        redactionRuns: [],
      }).verify,
    ).toBe(0)
  })

  // The header, the sidebar badge and the queue are three views of one number.
  it('summarises the queue as the same count the badge shows', () => {
    const runs = [
      run({ id: 'vrun_one' }),
      run({
        id: 'vrun_two',
        documentId: 'doc_2',
        createdAt: '2026-10-02T09:00:00Z',
        summary: {
          findingCount: 1,
          flaggedCount: 0,
          reviewRequiredCount: 1,
          notCheckedCount: 0,
          dismissedCount: 0,
        },
      }),
    ]
    const summary = summariseAttention(items({ verificationRuns: runs }))
    const work = openWorkCount({ verificationRuns: runs, redactionRuns: [] })
    expect(summary.total).toBe(work.total)
    expect(summary.verify).toBe(work.verify)
    expect(summary.queue).toBe(2)
    expect(summary.flagged).toBe(2)
    expect(summary.reviews).toBe(2)
  })
})
