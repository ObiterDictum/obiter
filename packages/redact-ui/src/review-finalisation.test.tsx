import type { RedactionRun } from './types'
import '@obiter/test-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  decidedRun,
  RedactionReviewView,
  hooks,
  onOpenRun,
  renderRun,
  spans,
} from './review.test-fixture'

describe('redaction finalisation and detection recovery', () => {
  it('blocks finalising while a detected span has no decision, and offers the way there', () => {
    renderRun({
      ...decidedRun,
      decisions: {
        span_1: {
          decision: 'accept' as const,
          decidedBy: 'usr_me',
          decidedAt: '2026-10-26T14:42:00.000Z',
        },
      },
      summary: { ...decidedRun.summary, reviewedCount: 1, unreviewedCount: 1 },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finalise' }))
    expect(screen.getByRole('alert').textContent).toContain(
      '1 detected span has no decision yet.',
    )
    expect(screen.getByRole('alert').textContent).toContain(
      'an undecided span is not the same as a span you chose to keep',
    )
    expect(
      screen.getByRole('button', { name: /Finalise redacted PDF/u }),
    ).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
    const undecided = screen
      .getAllByRole('option')
      .find((option) => option.textContent?.includes('9 May 1988'))
    expect(undecided?.getAttribute('aria-selected')).toBe('true')
  })

  it('repeats one decision on every occurrence of the same text', () => {
    const mutate = vi.fn()
    hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
    const repeated = [
      { ...spans[0]!, start: 0, end: 4 },
      { ...spans[0]!, id: 'span_3', start: 21, end: 25 },
    ]
    renderRun({
      spans: repeated,
      decisions: {
        span_1: {
          decision: 'accept',
          decidedBy: 'usr_me',
          decidedAt: '2026-10-26T14:42:00.000Z',
        },
      },
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Apply to all 2 occurrences' }),
    )
    expect(mutate).toHaveBeenCalledWith(
      {
        spanId: 'span_1',
        decision: 'accept',
        applyToSameText: true,
      },
      expect.any(Object),
    )
  })

  it('refuses to finalise while the same text is decided both ways', () => {
    const repeated = [
      { ...spans[0]!, start: 0, end: 4 },
      { ...spans[0]!, id: 'span_3', start: 21, end: 25 },
    ]
    renderRun({
      spans: repeated,
      decisions: {
        span_1: {
          decision: 'accept',
          decidedBy: 'usr_me',
          decidedAt: '2026-10-26T14:42:00.000Z',
        },
        span_3: {
          decision: 'reject',
          decidedBy: 'usr_me',
          decidedAt: '2026-10-26T14:43:00.000Z',
        },
      },
      summary: {
        ...decidedRun.summary,
        totalSpans: 2,
        reviewedCount: 2,
        unreviewedCount: 0,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finalise' }))
    expect(
      screen.getByText(/One piece of text has different decisions/u),
    ).toBeTruthy()
    expect(screen.getByText('1 redacted · 1 kept visible')).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/I have reviewed every page/u))
    expect(
      screen.getByRole('button', { name: /Finalise redacted PDF/u }),
    ).toHaveProperty('disabled', true)
  })

  it('allows DOCX finalisation with a deliberately kept duplicate', () => {
    const repeated = [
      { ...spans[0]!, start: 0, end: 4 },
      { ...spans[0]!, id: 'span_3', start: 21, end: 25 },
    ]
    renderRun({
      sourceFilename: 'statement.docx',
      spans: repeated,
      decisions: {
        span_1: {
          decision: 'accept',
          decidedBy: 'usr_me',
          decidedAt: '2026-10-26T14:42:00.000Z',
        },
        span_3: {
          decision: 'reject',
          decidedBy: 'usr_me',
          decidedAt: '2026-10-26T14:43:00.000Z',
        },
      },
      summary: {
        ...decidedRun.summary,
        totalSpans: 2,
        reviewedCount: 2,
        unreviewedCount: 0,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Finalise' }))
    expect(
      screen.queryByText(/One piece of text has different decisions/u),
    ).toBeNull()
    fireEvent.click(screen.getByLabelText(/I have reviewed every page/u))
    expect(
      screen.getByRole('button', { name: /Finalise redacted PDF/u }),
    ).toHaveProperty('disabled', false)
  })

  it('requires both the detection acknowledgement and the page review to finalise', () => {
    const mutate = vi.fn()
    hooks.useFinalizeRun.mockReturnValue({ mutate, isPending: false })
    renderRun({ ...decidedRun, detectionMode: 'heuristics+supplement' })

    expect(
      screen.getByRole('note', { name: 'Model detection did not run' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Finalise' }))

    const confirm = screen.getByRole('button', {
      name: /Finalise redacted PDF/u,
    })
    expect(confirm).toHaveProperty('disabled', true)

    fireEvent.click(
      screen.getByLabelText(/I acknowledge that model detection did not run/u),
    )
    expect(confirm).toHaveProperty('disabled', true)

    fireEvent.click(screen.getByLabelText(/I have reviewed every page/u))
    expect(confirm).toHaveProperty('disabled', false)
    fireEvent.click(confirm)
    expect(mutate).toHaveBeenCalledWith(
      { outputMode: 'redacted', degradedDetectionAcknowledged: true },
      expect.any(Object),
    )
  })

  it('acknowledges unknown detection provenance with its own flag', () => {
    const mutate = vi.fn()
    hooks.useFinalizeRun.mockReturnValue({ mutate, isPending: false })
    renderRun({ ...decidedRun, detectionMode: 'unknown' })
    fireEvent.click(screen.getByRole('button', { name: 'Finalise' }))
    expect(
      screen.getAllByText(/Obiter cannot confirm whether model detection ran/u)
        .length,
    ).toBeGreaterThan(0)
    fireEvent.click(
      screen.getByLabelText(/I acknowledge that the detection mode was not/u),
    )
    fireEvent.click(screen.getByLabelText(/I have reviewed every page/u))
    fireEvent.click(
      screen.getByRole('button', { name: /Finalise redacted PDF/u }),
    )
    expect(mutate).toHaveBeenCalledWith(
      { outputMode: 'redacted', unknownDetectionAcknowledged: true },
      expect.any(Object),
    )
  })

  it('reports a failed detection run with its reason instead of an empty queue', () => {
    renderRun({
      ...decidedRun,
      status: 'failed',
      spans: [],
      decisions: {},
      summary: {
        ...decidedRun.summary,
        totalSpans: 0,
        reviewedCount: 0,
        unreviewedCount: 0,
        failureReason: 'Text extraction failed.',
      },
    })
    expect(screen.getByText('Detection failed')).toBeTruthy()
    expect(screen.getByText(/Text extraction failed\./u)).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('gives a failed detection the two ways out of it', () => {
    const onBack = vi.fn()
    const run: RedactionRun = {
      ...decidedRun,
      status: 'failed',
      sourceFilename: 'witness-statement.docx',
      sourceMimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      spans: [],
      decisions: {},
      summary: {
        ...decidedRun.summary,
        totalSpans: 0,
        reviewedCount: 0,
        unreviewedCount: 0,
        failureReason: 'No text layer was found in this PDF.',
      },
    }
    hooks.useRedactionRun.mockReturnValue({ isPending: false, data: run })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: '' },
    })
    render(
      <RedactionReviewView
        runId={run.id}
        onOpenRun={onOpenRun}
        onBack={onBack}
      />,
    )
    expect(screen.queryByText(/text layer/iu)).toBeNull()
    expect(screen.getByText(/could not read this Word document/u)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Try another file' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Redact' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('keeps the zero-span copy honest about what detection cannot see', () => {
    renderRun({
      ...decidedRun,
      spans: [],
      decisions: {},
      detectionMode: 'heuristics+supplement',
      summary: {
        totalSpans: 0,
        byCategory: {} as RedactionRun['summary']['byCategory'],
        bySource: { rampartModel: 0, rampartDeterministic: 0, ukSupplement: 0 },
        reviewedCount: 0,
        unreviewedCount: 0,
      },
    })
    expect(screen.getByText('Model detection did not run')).toBeTruthy()
    expect(screen.getByText(/Only the fixed patterns ran/u)).toBeTruthy()
  })

  it('keeps rendering when a background refetch errors but cached data remains', () => {
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      error: new Error('reconcile GET failed'),
      data: decidedRun,
    })
    hooks.useRedactionDocumentText.mockReturnValue({
      isPending: false,
      data: { text: 'Jane (born 9 May 1988) filed.' },
    })
    render(<RedactionReviewView runId="red_1" onOpenRun={onOpenRun} />)
    expect(
      screen.getByRole('heading', { name: 'statement-of-mrs-hughes.pdf' }),
    ).toBeTruthy()
  })

  it('opens the fresh run returned by model re-detection', () => {
    const redetectMutate = vi.fn()
    hooks.useRedetectRun.mockReturnValue({
      mutate: redetectMutate,
      isPending: false,
      error: null,
    })
    renderRun({ ...decidedRun, detectionMode: 'heuristics+supplement' })
    fireEvent.click(
      screen.getByRole('button', { name: 'Run model detection again' }),
    )
    expect(redetectMutate).toHaveBeenCalledWith(undefined, expect.any(Object))
    redetectMutate.mock.calls[0]![1].onSuccess({
      run: { ...decidedRun, id: 'red_2', replacesRunId: 'red_1' },
      redetectedFromRunId: 'red_1',
    })
    expect(onOpenRun).toHaveBeenCalledWith('red_2')
  })

  it('removes every decision surface from a replaced run and links the replacement', () => {
    renderRun({
      ...decidedRun,
      detectionMode: 'heuristics+supplement',
      replacementRunId: 'red_2',
    })
    expect(screen.getByText('Replaced')).toBeTruthy()
    expect(
      screen.getAllByText(/newer model-detected run is available/u).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Finalise' })).toBeNull()
    expect(
      screen.queryByRole('region', { name: 'Decide the selected span' }),
    ).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'Open replacement run' }),
    )
    expect(onOpenRun).toHaveBeenCalledWith('red_2')
  })
})
