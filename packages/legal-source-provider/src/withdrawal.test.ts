import { describe, expect, it } from 'vitest'
import { readWithdrawalCandidate, readWithdrawnInfo } from './withdrawal'

describe('withdrawal state readers', () => {
  it('reads a well-formed candidate and withdrawn blob', () => {
    expect(
      readWithdrawalCandidate({
        withdrawalCandidate: {
          firstSeenAt: '2026-08-01T00:00:00.000Z',
          runId: 'run-0',
          checkedUris: ['/uksc/2024/99'],
        },
      }),
    ).toEqual({
      firstSeenAt: '2026-08-01T00:00:00.000Z',
      runId: 'run-0',
      checkedUris: ['/uksc/2024/99'],
    })
    expect(
      readWithdrawnInfo({
        withdrawn: {
          at: '2026-09-01T00:00:00.000Z',
          checkedUris: ['/uksc/2024/99'],
          runIds: ['run-0', 'run-1'],
        },
      }),
    ).toEqual({
      at: '2026-09-01T00:00:00.000Z',
      checkedUris: ['/uksc/2024/99'],
      runIds: ['run-0', 'run-1'],
    })
  })

  it('returns null for absent or malformed state, never throwing', () => {
    expect(readWithdrawalCandidate({})).toBeNull()
    expect(readWithdrawnInfo({})).toBeNull()
    expect(readWithdrawalCandidate(null)).toBeNull()
    expect(
      readWithdrawnInfo({ withdrawn: { at: 42, checkedUris: [], runIds: [] } }),
    ).toBeNull()
    expect(
      readWithdrawalCandidate({
        withdrawalCandidate: { firstSeenAt: 'x', runId: 'r', checkedUris: [7] },
      }),
    ).toBeNull()
  })
})
