import { describe, expect, it } from 'bun:test'
import type { VerificationRun } from '@obiter/contracts'
import type { RedactionRunListItem } from '../redaction-runs'
import {
  buildAttentionItems,
  rankAttentionItems,
  summariseAttention,
  type AttentionItem,
} from './home-attention'
import {
  attentionExplanation,
  attentionStatus,
  attentionSummaryText,
} from './home-attention-copy'

function verificationRun(
  overrides: Partial<VerificationRun> & { id: string },
): VerificationRun {
  return {
    organisationId: 'org_1',
    matterId: 'mtr_1',
    documentId: 'doc_1',
    documentVersionId: 'ver_1',
    status: 'completed',
    failureCode: null,
    createdBy: 'usr_1',
    createdAt: '2026-10-26T09:02:00.000Z',
    startedAt: '2026-10-26T09:02:00.000Z',
    completedAt: '2026-10-26T09:04:00.000Z',
    summary: { findingCount: 3, flaggedCount: 1, reviewRequiredCount: 2 },
    documentCurrentVersionId: 'ver_1',
    stale: false,
    ...overrides,
  }
}

function redactionRun(
  overrides: Partial<RedactionRunListItem> & { id: string },
): RedactionRunListItem {
  return {
    sourceFilename: 'witness-statement.docx',
    status: 'reviewing',
    matterId: 'mtr_1',
    matterName: 'Northgate',
    createdAt: '2026-10-25T16:20:00.000Z',
    updatedAt: '2026-10-25T16:20:00.000Z',
    summary: {
      totalSpans: 21,
      reviewedCount: 18,
      unreviewedCount: 3,
      byDecision: { accept: 15, override_redact: 0, undecided: 3 },
    },
    ...overrides,
  }
}

const sources = {
  documentFilenames: new Map([['doc_1', 'advice-note.docx']]),
  matters: new Map([
    ['mtr_1', { name: 'Northgate', clientReference: 'NGF-1' }],
  ]),
}

function build(
  verificationRuns: VerificationRun[],
  redactionRuns: RedactionRunListItem[],
) {
  return buildAttentionItems({
    ...sources,
    verificationRuns,
    redactionRuns,
  })
}

function kinds(items: AttentionItem[]) {
  return items.map((item) => item.kind)
}

describe('rankAttentionItems', () => {
  it('ranks legal risk first and stopped work last', () => {
    const items = build(
      [
        verificationRun({
          id: 'verify_review',
          summary: { findingCount: 1, flaggedCount: 0, reviewRequiredCount: 1 },
        }),
        verificationRun({
          id: 'verify_failed',
          status: 'failed',
          failureCode: 'execution_failed',
          completedAt: '2026-10-26T14:27:00.000Z',
        }),
        verificationRun({ id: 'verify_flagged' }),
      ],
      [redactionRun({ id: 'redact_1' })],
    )

    expect(kinds(rankAttentionItems(items))).toEqual([
      'verify_flagged',
      'redact_decision',
      'verify_review',
      'verify_failed',
    ])
  })

  it('puts the longest wait first inside one risk tier', () => {
    const items = build(
      [
        verificationRun({
          id: 'newer',
          completedAt: '2026-10-26T09:00:00.000Z',
        }),
        verificationRun({
          id: 'older',
          completedAt: '2026-10-20T09:00:00.000Z',
        }),
      ],
      [],
    )

    expect(rankAttentionItems(items).map((item) => item.runId)).toEqual([
      'older',
      'newer',
    ])
  })

  it('breaks an exact tie by id so the order never jitters', () => {
    const items = build(
      [
        verificationRun({
          id: 'run_b',
          completedAt: '2026-10-26T09:00:00.000Z',
        }),
        verificationRun({
          id: 'run_a',
          completedAt: '2026-10-26T09:00:00.000Z',
        }),
      ],
      [],
    )

    expect(rankAttentionItems(items).map((item) => item.runId)).toEqual([
      'run_a',
      'run_b',
    ])
  })

  it('orders a failed Verify run and a failed Redaction run by the same wait rule', () => {
    const items = build(
      [
        verificationRun({
          id: 'verify_failed',
          status: 'failed',
          completedAt: '2026-10-20T09:00:00.000Z',
        }),
      ],
      [
        redactionRun({
          id: 'redact_failed',
          status: 'failed',
          updatedAt: '2026-10-26T09:00:00.000Z',
        }),
      ],
    )

    expect(kinds(rankAttentionItems(items))).toEqual([
      'verify_failed',
      'redact_failed',
    ])
  })

  it('returns nothing for an empty queue', () => {
    expect(rankAttentionItems([])).toEqual([])
  })
})

describe('buildAttentionItems', () => {
  it('drops work that is not waiting on a person', () => {
    const items = build(
      [
        verificationRun({ id: 'running', status: 'running' }),
        verificationRun({
          id: 'clear',
          summary: { findingCount: 1, flaggedCount: 0, reviewRequiredCount: 0 },
        }),
      ],
      [
        redactionRun({ id: 'detecting', status: 'detecting' }),
        redactionRun({ id: 'done', status: 'finalized' }),
        redactionRun({
          id: 'decided',
          status: 'ready_for_review',
          summary: { totalSpans: 4, byDecision: { accept: 4, undecided: 0 } },
        }),
      ],
    )

    expect(items).toEqual([])
  })

  it('names the document, matter and the run failure from the data it was given', () => {
    const [item] = build(
      [
        verificationRun({
          id: 'failed',
          status: 'failed',
          failureCode: 'execution_failed',
        }),
      ],
      [],
    )
    if (!item) throw new Error('expected one attention item')

    expect(item.filename).toBe('advice-note.docx')
    expect(item.matterName).toBe('Northgate')
    expect(item.matterReference).toBe('NGF-1')
    expect(item.waitingSince).toBe('2026-10-26T09:04:00.000Z')
    expect(attentionStatus(item)).toEqual({ label: 'Failed', tone: 'danger' })
  })

  it('fails loudly on a run status the shell does not know', () => {
    expect(() =>
      build(
        [verificationRun({ id: 'unknown', status: 'paused' as never })],
        [],
      ),
    ).toThrow('Unknown verification run status: paused')
    expect(() =>
      build([], [redactionRun({ id: 'unknown', status: 'paused' as never })]),
    ).toThrow('Unknown redaction run status: paused')
  })
})

describe('attention copy', () => {
  it('states the undecided span count from the run summary', () => {
    const [item] = build([], [redactionRun({ id: 'redact_1' })])
    if (!item) throw new Error('expected one attention item')

    expect(attentionExplanation(item)).toBe(
      '3 of 21 detected spans still need a decision before the run can be finalised.',
    )
    expect(attentionStatus(item)).toEqual({ label: 'In review', tone: 'info' })
  })

  it('summarises only the kinds that are actually queued', () => {
    const items = build(
      [
        verificationRun({ id: 'flagged' }),
        verificationRun({
          id: 'failed',
          status: 'failed',
          completedAt: '2026-10-26T14:27:00.000Z',
        }),
      ],
      [],
    )

    expect(attentionSummaryText(summariseAttention(items))).toBe(
      '2 items need your attention: 1 legal-accuracy risk and 1 failed run.',
    )
    expect(attentionSummaryText(summariseAttention([]))).toBe(
      'Nothing needs your attention right now.',
    )
  })
})
