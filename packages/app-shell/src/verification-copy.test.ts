import { describe, expect, it } from 'bun:test'
import type { VerificationRun } from '@obiter/contracts'
import {
  verificationReasonLabel,
  verificationRunTime,
  verificationStateLabel,
  verificationTypeLabel,
} from './verification-copy'

describe('verification copy', () => {
  it('does not use internal discriminant names as user copy', () => {
    expect(verificationTypeLabel('authority_existence')).toBe(
      'Authority existence',
    )
    expect(verificationStateLabel('review_required')).toBe('Needs review')
    expect(verificationReasonLabel('authority_not_held')).toBe(
      'The stored sources do not hold this authority.',
    )
    expect(verificationReasonLabel('authority_not_held')).not.toContain(
      'authority_not_held',
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
    summary: { findingCount: 0, flaggedCount: 0, reviewRequiredCount: 0 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

const formatted = (at: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(at))

describe('verificationRunTime', () => {
  it('labels a completed run with its completion time', () => {
    expect(verificationRunTime(run())).toBe(
      `Completed ${formatted('2026-09-14T02:00:00.000Z')}`,
    )
  })

  it('labels a failed run with when the failure was recorded, not when it was requested', () => {
    const label = verificationRunTime(
      run({ status: 'failed', failureCode: 'execution_failed' }),
    )
    expect(label).toBe(`Failed ${formatted('2026-09-14T02:00:00.000Z')}`)
    expect(label).not.toContain(formatted('2026-09-14T00:00:00.000Z'))
  })

  it('labels a running run with when it started', () => {
    expect(verificationRunTime(run({ status: 'running' }))).toBe(
      `Started ${formatted('2026-09-14T01:00:00.000Z')}`,
    )
  })

  it('labels a queued run with when it was created', () => {
    expect(
      verificationRunTime(run({ status: 'queued', startedAt: null })),
    ).toBe(`Created ${formatted('2026-09-14T00:00:00.000Z')}`)
  })

  it('falls back to the creation time when a terminal run has no completion time', () => {
    expect(
      verificationRunTime(run({ status: 'failed', completedAt: null })),
    ).toBe(`Created ${formatted('2026-09-14T00:00:00.000Z')}`)
  })
})
