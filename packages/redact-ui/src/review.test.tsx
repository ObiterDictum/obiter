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
  id: 'red_1',
  matterId: 'mtr_1',
  documentId: 'doc_1',
  documentVersionId: 'ver_1',
  status: 'finalized' as const,
  policyMode: 'internal_ai_minimisation' as const,
  spans: [
    {
      id: 'span_1',
      start: 0,
      end: 4,
      text: 'Jane',
      category: 'person_name' as const,
      source: 'rampart_model' as const,
      confidence: 'high' as const,
      suggestion: 'redact' as const,
    },
  ],
  decisions: {},
  outputArtifactId: 'art_1',
  detectorVersion: null,
  detectionMode: 'model+supplement' as const,
  summary: {
    totalSpans: 1,
    byCategory: { person_name: 1 },
    bySource: { rampartModel: 1, rampartDeterministic: 0, ukSupplement: 0 },
    reviewedCount: 0,
    unreviewedCount: 1,
  },
  createdAt: '2026-07-09T00:00:00.000Z',
  updatedAt: '2026-07-09T00:00:00.000Z',
}

describe('RedactionReviewView', () => {
  it('renders highlighted source-aware spans in the shared review screen', () => {
    hooks.useRedactionRun.mockReturnValue({ isPending: false, data: run })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: { text: '[REDACTED] filed.' },
    })
    hooks.useSpanDecision.mockReturnValue({})
    hooks.useFinalizeRun.mockReturnValue({})
    render(<RedactionReviewView runId="red_1" />)
    expect(
      screen.getByRole('heading', { name: 'Redaction review' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Jane' }).className).toContain(
      'bg-span-person-name',
    )
    expect(screen.getByRole('button', { name: 'Jane' }).title).toContain(
      'Rampart model',
    )
  })

  it('submits the decision shortcuts when the span list has focus', () => {
    const mutate = vi.fn()
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: { ...run, status: 'ready_for_review' },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false })
    hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
    hooks.useFinalizeRun.mockReturnValue({})
    render(<RedactionReviewView runId="red_1" />)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'r' })
    expect(mutate).toHaveBeenCalledWith({
      spanId: 'span_1',
      decision: 'reject',
    })
  })

  it('shows finalized output for a zero-span finalized run', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...run,
        spans: [],
        status: 'finalized',
        summary: {
          totalSpans: 0,
          byCategory: {},
          bySource: {
            rampartModel: 0,
            rampartDeterministic: 0,
            ukSupplement: 0,
          },
          reviewedCount: 0,
          unreviewedCount: 0,
        },
      },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Clean text.' },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: { text: 'Clean text.' },
    })
    hooks.useSpanDecision.mockReturnValue({})
    hooks.useFinalizeRun.mockReturnValue({})
    render(<RedactionReviewView runId="red_1" />)
    expect(screen.getByText('Finalized')).toBeTruthy()
    expect(
      screen.getByRole('region', { name: 'Redaction output' }),
    ).toBeTruthy()
    expect(
      screen.queryByText('No sensitive data was detected in this document'),
    ).toBeNull()
  })

  it('keeps degraded zero-span copy accurate when the model did not run', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...run,
        spans: [],
        status: 'ready_for_review',
        detectionMode: 'heuristics+supplement',
        summary: {
          totalSpans: 0,
          byCategory: {},
          bySource: {
            rampartModel: 0,
            rampartDeterministic: 0,
            ukSupplement: 0,
          },
          reviewedCount: 0,
          unreviewedCount: 0,
        },
      },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Clean text.' },
    })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false })
    hooks.useSpanDecision.mockReturnValue({})
    hooks.useFinalizeRun.mockReturnValue({})

    render(<RedactionReviewView runId="red_1" />)

    expect(screen.getByText('Model detection did not run')).toBeTruthy()
    expect(
      screen.getByText(/The deterministic detectors did not find/),
    ).toBeTruthy()
    expect(
      screen.queryByText(/Rampart and the UK supplement did not find/),
    ).toBeNull()
  })

  it('keeps rendering when a background run refetch errors but cached data remains', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      error: new Error('reconcile GET failed'),
      data: run,
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: { text: '[REDACTED] filed.' },
    })
    hooks.useSpanDecision.mockReturnValue({})
    hooks.useFinalizeRun.mockReturnValue({})
    render(<RedactionReviewView runId="red_1" />)
    expect(
      screen.getByRole('heading', { name: 'Redaction review' }),
    ).toBeTruthy()
    expect(screen.queryByText('Could not load this redaction run')).toBeNull()
  })

  it('warns throughout degraded review and requires acknowledgement before finalizing', () => {
    const mutate = vi.fn()
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...run,
        status: 'ready_for_review',
        detectionMode: 'heuristics+supplement',
        summary: {
          ...run.summary,
          reviewedCount: 1,
          unreviewedCount: 0,
        },
      },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false })
    hooks.useSpanDecision.mockReturnValue({ mutate: vi.fn(), isPending: false })
    hooks.useFinalizeRun.mockReturnValue({ mutate, isPending: false })

    render(<RedactionReviewView runId="red_1" />)

    expect(screen.getByText('Model detection did not run')).toBeTruthy()
    expect(
      screen.getByText(
        /Names, addresses and dates of birth were not automatically detected/,
      ),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }))

    expect(screen.getAllByText('Model detection did not run')).toHaveLength(2)
    const confirm = screen.getByRole('button', { name: 'Confirm finalize' })
    expect(confirm).toHaveProperty('disabled', true)

    fireEvent.click(
      screen.getByLabelText(
        /I acknowledge that model detection did not run and have manually checked/,
      ),
    )
    expect(confirm).toHaveProperty('disabled', false)
    fireEvent.click(confirm)

    expect(mutate).toHaveBeenCalledWith(
      {
        outputMode: 'redacted',
        degradedDetectionAcknowledged: true,
      },
      expect.any(Object),
    )
  })

  it('does not warn or require degraded acknowledgement for model detection', () => {
    const mutate = vi.fn()
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...run,
        status: 'ready_for_review',
        summary: {
          ...run.summary,
          reviewedCount: 1,
          unreviewedCount: 0,
        },
      },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false })
    hooks.useSpanDecision.mockReturnValue({ mutate: vi.fn(), isPending: false })
    hooks.useFinalizeRun.mockReturnValue({ mutate, isPending: false })

    render(<RedactionReviewView runId="red_1" />)

    expect(screen.queryByText('Model detection did not run')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }))
    const confirm = screen.getByRole('button', { name: 'Confirm finalize' })
    expect(confirm).toHaveProperty('disabled', false)
    fireEvent.click(confirm)

    expect(mutate).toHaveBeenCalledWith(
      { outputMode: 'redacted' },
      expect.any(Object),
    )
  })
})
