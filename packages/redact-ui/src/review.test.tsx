import '@obiter/test-dom'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { RedactionRun } from './types'

const hooks = vi.hoisted(() => ({
  useRedactionRun: vi.fn(),
  useRedactionDocumentText: vi.fn(),
  useRedactionOutput: vi.fn(() => ({ isPending: false })),
  useRedactionOutputFile: vi.fn(() => ({
    isPending: false,
    data: undefined,
    error: null,
  })),
  useRedactionScheduleExport: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
    variables: undefined,
  })),
  useCreateUploadedRedactionRun: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })),
  useSpanDecision: vi.fn(
    (): {
      mutate: ReturnType<typeof vi.fn>
      isPending: boolean
      error?: Error | null
    } => ({ mutate: vi.fn(), isPending: false }),
  ),
  useFinalizeRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRedetectRun: vi.fn(
    (): {
      mutate: ReturnType<typeof vi.fn>
      isPending: boolean
      error?: Error | null
    } => ({ mutate: vi.fn(), isPending: false }),
  ),
  useReturnToDocument: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}))

const sourcePreviewHooks = vi.hoisted(() => ({
  useRedactionSource: vi.fn(() => ({
    isPending: false,
    data: undefined,
    isError: false,
  })),
}))

const appShell = vi.hoisted(() => ({
  currentUserId: 'usr_me' as string,
}))

const hooksKeys = Object.fromEntries(
  Object.keys(await import('./hooks')).map((key) => [key, undefined]),
)
mock.module('./hooks', () => Object.assign({ ...hooksKeys }, hooks))
const sourcePreviewKeys = Object.fromEntries(
  Object.keys(await import('./source-preview-hooks')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('./source-preview-hooks', () =>
  Object.assign({ ...sourcePreviewKeys }, sourcePreviewHooks),
)
// The page scaffold and the signed-in user come from the shell. Mocked at the
// package boundary so the screen renders without booting the shell's auth.
mock.module('@obiter/app-shell', () => ({
  useCurrentUser: () => ({ data: { user: { id: appShell.currentUserId } } }),
  PageScaffold: ({
    title,
    description,
    actions,
    children,
  }: {
    title: string
    description?: string
    actions?: React.ReactNode
    children: React.ReactNode
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {actions}
      {children}
    </div>
  ),
}))

const { RedactionReviewView } = await import('./review')

const onOpenRun = vi.fn()

// jsdom does not implement CSS.escape, which the review's selection effect uses
// to find the selected span by id. Provide the browser boundary so row
// activation can be exercised; this is not the behaviour under test.
if (typeof globalThis.CSS === 'undefined') {
  Object.assign(globalThis, { CSS: { escape: (value: string) => value } })
}
if (typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = () => undefined
}

const spans: RedactionRun['spans'] = [
  {
    id: 'span_1',
    start: 0,
    end: 4,
    text: 'Jane',
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
  },
  {
    id: 'span_2',
    start: 5,
    end: 15,
    text: '9 May 1988',
    category: 'date',
    source: 'rampart_model',
    confidence: 'medium',
    suggestion: 'redact',
  },
]

const decidedRun: RedactionRun = {
  id: 'red_1',
  matterId: null,
  matterName: null,
  documentId: null,
  documentVersionId: null,
  sourceFilename: 'statement-of-mrs-hughes.pdf',
  sourcePreview: { kind: 'text', available: false },
  status: 'reviewing',
  policyMode: 'internal_ai_minimisation',
  spans,
  decisions: {
    span_1: {
      decision: 'accept',
      decidedBy: 'usr_me',
      decidedAt: '2026-10-26T14:42:00.000Z',
    },
    span_2: {
      decision: 'reject',
      decidedBy: 'usr_other',
      decidedAt: '2026-10-26T15:02:00.000Z',
    },
  },
  outputId: null,
  detectorVersion: null,
  detectionMode: 'model+supplement',
  replacesRunId: null,
  replacementRunId: null,
  returnedDocumentVersionId: null,
  summary: {
    totalSpans: 2,
    byCategory: {
      person_name: 1,
      date: 1,
    } as RedactionRun['summary']['byCategory'],
    bySource: { rampartModel: 2, rampartDeterministic: 0, ukSupplement: 0 },
    reviewedCount: 2,
    unreviewedCount: 0,
  },
  createdAt: '2026-10-26T14:00:00.000Z',
  updatedAt: '2026-10-26T14:00:00.000Z',
}

function renderRun(overrides: Partial<RedactionRun> = {}) {
  const run = { ...decidedRun, ...overrides }
  hooks.useRedactionRun.mockReturnValue({ isPending: false, data: run })
  hooks.useRedactionDocumentText.mockReturnValue({
    isPending: false,
    data: { text: 'Jane (born 9 May 1988) filed.' },
  })
  return render(<RedactionReviewView runId={run.id} onOpenRun={onOpenRun} />)
}

beforeEach(() => {
  onOpenRun.mockReset()
  appShell.currentUserId = 'usr_me'
  hooks.useSpanDecision.mockReturnValue({ mutate: vi.fn(), isPending: false })
  hooks.useFinalizeRun.mockReturnValue({ mutate: vi.fn(), isPending: false })
  hooks.useRedetectRun.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  })
  hooks.useRedactionOutput.mockReturnValue({ isPending: false })
})

describe('redaction review', () => {
  it('states what the detector found and how sure it is, in plain words', () => {
    renderRun()
    expect(
      screen.getByRole('heading', {
        name: 'statement-of-mrs-hughes.pdf',
      }),
    ).toBeTruthy()
    expect(screen.getByText('2 of 2 detected spans decided')).toBeTruthy()

    // The document mark states its category in words for a screen reader, so
    // the category colour is never the only cue.
    const mark = screen.getByRole('button', { name: /Jane/u })
    expect(mark.className).toContain('bg-span-person-name')
    expect(mark.textContent).toContain('Person name')
    // The legend names every colour in use on the page.
    const legend = screen.getByRole('list', {
      name: 'Category colours in this document',
    })
    expect(within(legend).getByText('Person name')).toBeTruthy()
    expect(within(legend).getByText('Date')).toBeTruthy()

    const bar = screen.getByRole('region', {
      name: 'Decide the selected span',
    })
    expect(
      within(bar).getByText(/Found automatically · high confidence/u),
    ).toBeTruthy()
    expect(
      within(bar).getByText(/the text matches what was looked for/u),
    ).toBeTruthy()
    expect(
      within(bar).getByText(
        /Detection confidence is not a disclosure decision/u,
      ),
    ).toBeTruthy()
    // Detector internals say nothing a reviewer can act on.
    expect(screen.queryByText(/Rampart|UK supplement|model ·/u)).toBeNull()
    // The coverage caveat belongs on the start page and the finalise dialog,
    // not a third time beside the progress bar.
    expect(
      screen.queryByText(/Detection finds candidates, not everything/u),
    ).toBeNull()
    // Nothing in the screen claims undetected text is safe.
    expect(screen.queryByText(/safe to disclose/iu)).toBeNull()
  })

  it('shows the reviewer and the decision time for each decided span', () => {
    renderRun()
    const options = screen.getAllByRole('option')
    expect(options[0]?.textContent).toContain('Redacted by you')
    expect(options[0]?.textContent).toContain('26 Oct 2026, 14:42')
    expect(options[1]?.textContent).toContain(
      'Kept visible by another reviewer',
    )
    expect(options[1]?.textContent).toContain('26 Oct 2026, 15:02')
    // A span with no decision says so rather than borrowing a time.
    renderRun({
      ...decidedRun,
      decisions: {},
      summary: {
        ...decidedRun.summary,
        reviewedCount: 0,
        unreviewedCount: 2,
      },
    })
    const undecided = screen.getAllByRole('option').slice(-2)
    expect(undecided[0]?.textContent).toContain('Needs review')
    expect(undecided[0]?.textContent).not.toContain('by you')
  })

  it('counts each decision state and filters the queue by it', () => {
    renderRun()
    expect(
      screen.getByRole('tab', { name: 'All 2' }).getAttribute('aria-selected'),
    ).toBe('true')
    expect(screen.getByRole('tab', { name: 'Kept 1' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Unreviewed 0' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Kept 1' }))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]?.textContent).toContain('9 May 1988')
    // The decision bar follows the filter rather than keeping a hidden span.
    const bar = screen.getByRole('region', {
      name: 'Decide the selected span',
    })
    expect(within(bar).getByText('9 May 1988')).toBeTruthy()
  })

  it('decides the selected span from the listbox and ignores modified chords', () => {
    const mutate = vi.fn()
    hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
    renderRun()
    const listbox = screen.getByRole('listbox', { name: 'Detected spans' })

    fireEvent.keyDown(listbox, { key: 'r' })
    expect(mutate).toHaveBeenCalledWith({
      spanId: 'span_1',
      decision: 'reject',
    })

    mutate.mockClear()
    // Ctrl+K opens app search and Ctrl+R reloads the browser; Meta is the macOS
    // equivalent. None may record a redaction decision.
    for (const chord of [
      { key: 'k', ctrlKey: true },
      { key: 'r', ctrlKey: true },
      { key: 'k', metaKey: true },
      { key: 'r', metaKey: true },
      { key: 'r', altKey: true },
      { key: 'Enter', ctrlKey: true },
    ])
      fireEvent.keyDown(listbox, chord)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('never decides on the selected span when a different row has focus', () => {
    const mutate = vi.fn()
    hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
    renderRun()
    const listbox = screen.getByRole('listbox', { name: 'Detected spans' })
    const rows = screen.getAllByRole('option')
    fireEvent.click(rows[0]!)

    for (const key of ['r', 'p', 'Enter'])
      expect(fireEvent.keyDown(rows[1]!, { key })).toBe(true)
    expect(mutate).not.toHaveBeenCalled()

    fireEvent.click(rows[1]!)
    fireEvent.keyDown(listbox, { key: 'r' })
    expect(mutate).toHaveBeenCalledWith({
      spanId: 'span_2',
      decision: 'reject',
    })
  })

  it('walks the run with the decision bar without changing a decision', () => {
    const mutate = vi.fn()
    hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
    renderRun()
    const bar = screen.getByRole('region', {
      name: 'Decide the selected span',
    })
    expect(within(bar).getByText('1 of 2')).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Next span' }))
    expect(within(bar).getByText('2 of 2')).toBeTruthy()
    expect(within(bar).getByText('9 May 1988')).toBeTruthy()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('shows a failed decision instead of pretending it saved', () => {
    hooks.useSpanDecision.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      error: new Error('Redaction run not found.'),
    })
    renderRun()
    expect(screen.getByRole('alert').textContent).toContain(
      'The decision was not saved. Redaction run not found.',
    )
  })

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
    expect(mutate).toHaveBeenCalledWith({
      spanId: 'span_1',
      decision: 'accept',
      applyToSameText: true,
    })
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
    // The words that would leak are named, not counted anonymously.
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
    // The stored reason names a PDF; the file is a .docx, so it is not shown.
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
