import { describe, expect, it } from 'bun:test'
import type { DecisionRecord } from '@obiter/redaction-policy'
import { decisionRecord, formatDateTime } from './span-copy'

function record(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    decision: 'accept',
    decidedBy: 'usr_1',
    decidedAt: '2026-11-02T09:30:00.000Z',
    decidedByName: 'Alex Morgan',
    ...overrides,
  }
}

describe('redaction decision attribution', () => {
  it('marks a reviewer who has left the organisation', () => {
    expect(
      decisionRecord(record({ decidedByFormerMember: true }), 'usr_2'),
    ).toBe(
      `Redacted by Alex Morgan (former member) · ${formatDateTime('2026-11-02T09:30:00.000Z')}`,
    )
  })

  it('keeps a current reviewer unmarked and addresses the reader as you', () => {
    expect(decisionRecord(record(), 'usr_2')).toBe(
      `Redacted by Alex Morgan · ${formatDateTime('2026-11-02T09:30:00.000Z')}`,
    )
    expect(
      decisionRecord(record({ decidedByFormerMember: true }), 'usr_1'),
    ).toBe(`Redacted by you · ${formatDateTime('2026-11-02T09:30:00.000Z')}`)
  })

  it('still names the decision when the reviewer has no stored name', () => {
    expect(
      decisionRecord(
        record({ decidedByName: null, decision: 'reject' }),
        'usr_2',
      ),
    ).toBe(
      `Kept visible by another reviewer · ${formatDateTime('2026-11-02T09:30:00.000Z')}`,
    )
  })
})
