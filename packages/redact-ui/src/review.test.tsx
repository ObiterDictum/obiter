import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RedactionReviewView } from './review'

const hooks = vi.hoisted(() => ({
  useRedactionRun: vi.fn(),
  useRedactionDocumentText: vi.fn(),
  useRedactionOutput: vi.fn(),
  useSpanDecision: vi.fn(),
  useFinalizeRun: vi.fn(),
}))

vi.mock('./hooks', () => hooks)

const run = {
  id: 'red_1', matterId: 'mtr_1', documentId: 'doc_1', documentVersionId: 'ver_1',
  status: 'finalized' as const, policyMode: 'internal_ai_minimisation' as const,
  spans: [{ id: 'span_1', start: 0, end: 4, text: 'Jane', category: 'person_name' as const, source: 'rampart_model' as const, confidence: 'high' as const, suggestion: 'redact' as const }],
  decisions: {}, outputArtifactId: 'art_1', detectorVersion: null,
  summary: { totalSpans: 1, byCategory: { person_name: 1 }, bySource: { rampartModel: 1, rampartDeterministic: 0, ukSupplement: 0 }, reviewedCount: 0, unreviewedCount: 1 },
  createdAt: '2026-07-09T00:00:00.000Z', updatedAt: '2026-07-09T00:00:00.000Z',
}

describe('RedactionReviewView', () => {
  it('renders highlighted source-aware spans in the shared review screen', () => {
    hooks.useRedactionRun.mockReturnValue({ isPending: false, data: run })
    hooks.useRedactionDocumentText.mockReturnValue({ isPending: false, data: { text: 'Jane filed.' } })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false, data: { text: '[REDACTED] filed.' } })
    hooks.useSpanDecision.mockReturnValue({})
    hooks.useFinalizeRun.mockReturnValue({})
    render(<RedactionReviewView runId="red_1" />)
    expect(screen.getByRole('heading', { name: 'Redaction review' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Jane' }).className).toContain('bg-span-person-name')
    expect(screen.getByRole('button', { name: 'Jane' }).title).toContain('Rampart model')
  })

  it('submits the decision shortcuts when the span list has focus', () => {
    const mutate = vi.fn()
    hooks.useRedactionRun.mockReturnValue({ isPending: false, data: { ...run, status: 'ready_for_review' } })
    hooks.useRedactionDocumentText.mockReturnValue({ isPending: false, data: { text: 'Jane filed.' } })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false })
    hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
    hooks.useFinalizeRun.mockReturnValue({})
    render(<RedactionReviewView runId="red_1" />)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'r' })
    expect(mutate).toHaveBeenCalledWith({ spanId: 'span_1', decision: 'reject' })
  })
})
