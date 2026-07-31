import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RedactionReviewView as RedactionReviewViewComponent } from './review'

const hooks = vi.hoisted(() => ({
  useRedactionRun: vi.fn(),
  useRedactionDocumentText: vi.fn(),
  useRedactionOutput: vi.fn(),
  useRedactionOutputFile: vi.fn(() => ({
    isPending: false,
    data: undefined,
    error: null,
  })),
  useSpanDecision: vi.fn(),
  useFinalizeRun: vi.fn(),
  useRedetectRun: vi.fn(),
}))

const sourcePreviewHooks = vi.hoisted(() => ({
  useRedactionSourceFile: vi.fn(() => ({
    isPending: false,
    data: undefined,
    isError: false,
  })),
  useRedactionLayout: vi.fn(() => ({
    isPending: false,
    data: undefined,
    isError: false,
  })),
}))

vi.mock('./hooks', () => hooks)
vi.mock('./source-preview-hooks', () => sourcePreviewHooks)

const onOpenRun = vi.fn()

function RedactionReviewView({ runId }: { runId: string }) {
  return <RedactionReviewViewComponent runId={runId} onOpenRun={onOpenRun} />
}

const run = {
  id: 'red_1',
  matterId: 'mtr_1',
  documentId: 'doc_1',
  documentVersionId: 'ver_1',
  sourceFilename: 'source.txt',
  sourcePreview: { kind: 'text' as const, available: false },
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
  replacesRunId: null,
  replacementRunId: null,
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
  beforeEach(() => {
    onOpenRun.mockReset()
    hooks.useRedetectRun.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: null,
    })
  })

  it('renders highlighted source-aware spans in the shared review screen', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: { ...run, status: 'ready_for_review' },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: {
        text: '[REDACTED] filed.',
        mimeType: 'text/plain',
        filename: 'source-redacted.txt',
      },
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
      data: {
        text: 'Clean text.',
        mimeType: 'text/plain',
        filename: 'source-redacted.txt',
      },
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
      data: {
        text: '[REDACTED] filed.',
        mimeType: 'text/plain',
        filename: 'source-redacted.txt',
      },
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

    expect(
      screen.getByRole('note', { name: 'Model detection did not run' }),
    ).toBeTruthy()
    expect(
      screen.getByText(
        /Names, addresses and dates of birth were not automatically detected/,
      ),
    ).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }))

    expect(screen.getAllByText('Model detection did not run')).toHaveLength(2)
    expect(
      screen.getByRole('alert', { name: 'Model detection did not run' }),
    ).toBeTruthy()
    expect(
      screen.queryAllByRole('button', { name: 'Run model detection again' }),
    ).toHaveLength(0)
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

  it('warns truthfully and requires a distinct acknowledgement when detection provenance is unknown', () => {
    const mutate = vi.fn()
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...run,
        status: 'ready_for_review',
        detectionMode: 'unknown',
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

    expect(
      screen.getByRole('note', { name: 'Detection mode was not recorded' }),
    ).toBeTruthy()
    expect(
      screen.getByText(/We cannot confirm whether model detection ran/),
    ).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Finalize' }))
    const confirm = screen.getByRole('button', { name: 'Confirm finalize' })
    expect(confirm).toHaveProperty('disabled', true)
    fireEvent.click(
      screen.getByLabelText(
        /I acknowledge that the detection mode was not recorded/,
      ),
    )
    fireEvent.click(confirm)

    expect(mutate).toHaveBeenCalledWith(
      {
        outputMode: 'redacted',
        unknownDetectionAcknowledged: true,
      },
      expect.any(Object),
    )
  })

  it('opens the fresh run returned by model re-detection', () => {
    const redetectMutate = vi.fn()
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: { ...run, detectionMode: 'heuristics+supplement' },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false })
    hooks.useSpanDecision.mockReturnValue({ mutate: vi.fn(), isPending: false })
    hooks.useFinalizeRun.mockReturnValue({ mutate: vi.fn(), isPending: false })
    hooks.useRedetectRun.mockReturnValue({
      mutate: redetectMutate,
      isPending: false,
      error: null,
    })

    render(<RedactionReviewView runId="red_1" />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Run model detection again' }),
    )

    expect(redetectMutate).toHaveBeenCalledWith(undefined, expect.any(Object))
    const mutationOptions = redetectMutate.mock.calls[0][1]
    mutationOptions.onSuccess({
      run: { ...run, id: 'red_2', replacesRunId: 'red_1' },
      redetectedFromRunId: 'red_1',
    })
    expect(onOpenRun).toHaveBeenCalledWith('red_2')
  })

  it('links to a model-detected replacement and prevents finalizing the source run', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: {
        ...run,
        status: 'ready_for_review',
        detectionMode: 'heuristics+supplement',
        replacementRunId: 'red_2',
      },
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({ isPending: false })
    hooks.useSpanDecision.mockReturnValue({ mutate: vi.fn(), isPending: false })
    hooks.useFinalizeRun.mockReturnValue({ mutate: vi.fn(), isPending: false })

    render(<RedactionReviewView runId="red_1" />)

    expect(screen.getByText('Replaced')).toBeTruthy()
    expect(
      screen.getByText(/newer model-detected run is available/),
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Finalize' })).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'Run model detection again' }),
    ).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'Open replacement run' }),
    )
    expect(onOpenRun).toHaveBeenCalledWith('red_2')
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

  it('defers object-URL revoke after download click', () => {
    vi.useFakeTimers()
    const urlApi = URL as unknown as {
      createObjectURL?: (blob: Blob) => string
      revokeObjectURL?: (url: string) => void
    }
    urlApi.createObjectURL ??= () => 'blob:missing'
    urlApi.revokeObjectURL ??= () => undefined
    const createObjectURL = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:download')
    const revokeObjectURL = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined)
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)

    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: run,
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane filed.' },
    })
    hooks.useRedactionOutput.mockReturnValue({
      isPending: false,
      data: {
        text: '[REDACTED] filed.',
        mimeType: 'text/plain',
        filename: 'source-redacted.txt',
      },
    })
    hooks.useSpanDecision.mockReturnValue({})
    hooks.useFinalizeRun.mockReturnValue({})

    render(<RedactionReviewView runId="red_1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))

    expect(createObjectURL).toHaveBeenCalled()
    expect(click).toHaveBeenCalled()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download')

    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    click.mockRestore()
    vi.useRealTimers()
  })
})
