import '@obiter/test-dom'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  decidedRun,
  RedactionReviewView,
  hooks,
  onOpenRun,
  renderRun,
} from './review.test-fixture'
describe('redaction review', () => {
  it('shows section progress without fetching review text until detection is ready', () => {
    const view = renderRun({
      status: 'detecting',
      detectionProgress: { completed: 12, total: 40 },
    })
    expect(screen.getByText('Detecting…')).toBeTruthy()
    expect(screen.getByText(/12 of 40 sections/u)).toBeTruthy()
    expect(hooks.useRedactionDocumentText).toHaveBeenLastCalledWith(
      'red_1',
      false,
    )
    hooks.useRedactionRun.mockReturnValue({
      isPending: false,
      data: decidedRun,
    })
    view.rerender(<RedactionReviewView runId="red_1" onOpenRun={onOpenRun} />)
    expect(screen.getByText('2 of 2 detected spans decided')).toBeTruthy()
    expect(hooks.useRedactionDocumentText).toHaveBeenLastCalledWith(
      'red_1',
      true,
    )
  })

  it('retries the stored source from the failed screen', () => {
    const retry = vi.fn()
    hooks.useRetryDetection.mockReturnValue({
      mutate: retry,
      isPending: false,
      error: null,
    })
    renderRun({ status: 'failed' })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })
  it('states what the detector found and how sure it is, in plain words', () => {
    renderRun()
    expect(
      screen.getByRole('heading', {
        name: 'statement-of-mrs-hughes.pdf',
      }),
    ).toBeTruthy()
    expect(screen.getByText('2 of 2 detected spans decided')).toBeTruthy()

    const mark = screen.getByRole('button', { name: /Jane/u })
    expect(mark.className).toContain('bg-span-person-name')
    expect(mark.textContent).toContain('Person name')
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
    expect(screen.queryByText(/Rampart|UK supplement|model ·/u)).toBeNull()
    expect(
      screen.queryByText(/Detection finds candidates, not everything/u),
    ).toBeNull()
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
    expect(mutate).toHaveBeenCalledWith(
      {
        spanId: 'span_1',
        decision: 'reject',
      },
      expect.any(Object),
    )

    mutate.mockClear()
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
    expect(mutate).toHaveBeenCalledWith(
      {
        spanId: 'span_2',
        decision: 'reject',
      },
      expect.any(Object),
    )
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
})

it('keeps review shortcuts out of editable fields, dialogs and other controls', () => {
  const mutate = vi.fn()
  hooks.useSpanDecision.mockReturnValue({ mutate, isPending: false })
  renderRun()
  const field = document.createElement('input')
  const editor = document.createElement('div')
  const textarea = document.createElement('textarea')
  const dialog = document.createElement('div')
  editor.setAttribute('contenteditable', 'true')
  dialog.setAttribute('role', 'dialog')
  document.body.append(field, editor, textarea)
  try {
    for (const target of [field, editor, textarea]) {
      fireEvent.keyDown(target, { key: 'r' })
      fireEvent.keyDown(target, { key: 'Enter' })
    }
    fireEvent.keyDown(screen.getByRole('button', { name: 'Finalise' }), {
      key: 'Enter',
    })
    document.body.append(dialog)
    fireEvent.keyDown(document.body, { key: 'r' })
    fireEvent.keyDown(document.body, { key: 'Enter' })
    expect(mutate).not.toHaveBeenCalled()
  } finally {
    field.remove()
    editor.remove()
    textarea.remove()
    dialog.remove()
  }
})

it('shows the page and the span list one at a time on a narrow pane', () => {
  renderRun()
  const switchGroup = screen.getByRole('group', { name: 'Review view' })
  const page = within(switchGroup).getByRole('button', { name: 'Page' })
  const spans = within(switchGroup).getByRole('button', { name: 'Spans' })
  const documentPane = window.document.querySelector('[data-review-pane]')
  const list = screen.getByRole('listbox', { name: 'Detected spans' })
  const panel = list.closest('aside')
  const decisionBar = screen.getByRole('region', {
    name: 'Decide the selected span',
  })

  expect(page.getAttribute('aria-pressed')).toBe('true')
  expect(documentPane?.className).not.toContain('@max-pane:hidden')
  expect(panel?.className).toContain('@max-pane:hidden')

  fireEvent.click(spans)
  expect(spans.getAttribute('aria-pressed')).toBe('true')
  expect(documentPane?.className).toContain('@max-pane:hidden')
  expect(panel?.className).not.toContain('@max-pane:hidden')

  fireEvent.click(page)
  expect(documentPane?.className).not.toContain('@max-pane:hidden')
  expect(panel?.className).toContain('@max-pane:hidden')
  expect(decisionBar.isConnected).toBe(true)
})
