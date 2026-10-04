import '@obiter/test-dom'
/*
 * E1: the Clipboard ribbon controls, the Ctrl/Cmd+B/I/U layer, and a
 * multi-paragraph paste. The pure splitter and the undo-grouping rule have
 * their own unit suites; this file drives them through the mounted workspace so
 * the availability rules, the accessible names and the single history step are
 * exercised the way a user meets them.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  mountWorkspace,
  multiParagraphModel,
  openRibbonTab,
  paragraph,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
  selectionStatus,
} from './paragraph-selection-harness'

function model() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

function stubClipboard(
  overrides: {
    writeText?: (text: string) => Promise<void>
    readText?: () => Promise<string>
  } = {},
) {
  const writeText = overrides.writeText ?? vi.fn().mockResolvedValue(undefined)
  const readText = overrides.readText ?? vi.fn().mockResolvedValue('')
  Object.defineProperty(window.navigator, 'clipboard', {
    configurable: true,
    value: { writeText, readText },
  })
  return { writeText, readText }
}

function control(prefix: string): HTMLButtonElement {
  const button = screen.getByRole('button', { name: new RegExp(`^${prefix}`) })
  if (!(button instanceof HTMLButtonElement)) throw new Error(`no ${prefix}`)
  return button
}

function renderedParagraphIds(): string[] {
  return [
    ...new Set(
      [...document.querySelectorAll('[data-paragraph-id]')].map(
        (node) => node.getAttribute('data-paragraph-id') ?? '',
      ),
    ),
  ]
}

describe('the clipboard ribbon controls', () => {
  it('enables Copy and Cut only with a document selection and Paste always', () => {
    mountWorkspace({ models: { doc_1: model() } })

    expect(control('Copy')).toHaveProperty('disabled', true)
    expect(control('Cut')).toHaveProperty('disabled', true)
    expect(control('Paste')).toHaveProperty('disabled', false)
    expect(control('Copy').getAttribute('aria-label')).toBe(
      'Copy: Select text to copy',
    )
    expect(control('Cut').getAttribute('aria-label')).toBe(
      'Cut: Select text to cut',
    )

    clickParagraph('p1')
    nativeSelect(1, 3)
    expect(control('Copy')).toHaveProperty('disabled', false)
    expect(control('Cut')).toHaveProperty('disabled', false)
    expect(control('Copy').getAttribute('aria-label')).toBe('Copy')
    expect(control('Cut').getAttribute('aria-label')).toBe('Cut')
  })

  it('copies the selection as plain text', async () => {
    const { writeText } = stubClipboard()
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    nativeSelect(1, 3)

    fireEvent.click(control('Copy'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('el'))
    // Copying must not touch the document.
    expect(bodyField().value).toBe('Hello')
  })

  it('cuts the selection and reverses it in one undo step', async () => {
    const { writeText } = stubClipboard()
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    nativeSelect(1, 3)

    fireEvent.click(control('Cut'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('el'))
    await waitFor(() => expect(bodyField().value).toBe('Hlo'))

    fireEvent.click(control('Undo'))
    expect(bodyField().value).toBe('Hello')
  })

  it('keeps the text and says why when the clipboard write fails', async () => {
    stubClipboard({
      writeText: vi.fn().mockRejectedValue(new Error('denied')),
    })
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    nativeSelect(1, 3)

    fireEvent.click(control('Cut'))
    await waitFor(() =>
      expect(selectionStatus()).toMatch(/clipboard could not be written/i),
    )
    // A failed cut must not delete text the clipboard never held.
    expect(bodyField().value).toBe('Hello')
  })

  it('pastes multiple paragraphs as one undo step', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('A\nB') })
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    nativeSelect(5, 5)

    fireEvent.click(control('Paste'))
    await waitFor(() => expect(renderedParagraphIds()).toHaveLength(3))
    // The caret lands in the pasted second paragraph, which is a pending insert.
    expect(
      (screen.getByLabelText('Pending paragraph text') as HTMLTextAreaElement)
        .value,
    ).toBe('B')

    // One paste is one history entry, however many paragraphs it created.
    fireEvent.click(control('Undo'))
    expect(renderedParagraphIds()).toHaveLength(2)
    expect(screen.queryByLabelText('Pending paragraph text')).toBeNull()
    await waitFor(() => expect(bodyField().value).toBe('Hello'))
  })

  it('pastes over a selection rather than at the caret', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('X') })
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    nativeSelect(1, 4)

    fireEvent.click(control('Paste'))
    await waitFor(() => expect(bodyField().value).toBe('HXo'))
  })
})

describe('the character-formatting keyboard layer', () => {
  function pressed(name: string): string | null {
    return control(name).getAttribute('aria-pressed')
  }

  it('toggles Bold, Italic and Underline from Ctrl/Cmd chords', () => {
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')

    fireEvent.keyDown(bodyField(), { key: 'b', ctrlKey: true })
    expect(pressed('Bold')).toBe('true')
    fireEvent.keyDown(bodyField(), { key: 'b', ctrlKey: true })
    expect(pressed('Bold')).toBe('false')

    fireEvent.keyDown(bodyField(), { key: 'i', metaKey: true })
    expect(pressed('Italic')).toBe('true')

    fireEvent.keyDown(bodyField(), { key: 'u', ctrlKey: true })
    expect(pressed('Underline')).toBe('true')
  })

  it('applies the chord to the bold body run', () => {
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    nativeSelect(0, 5)

    fireEvent.keyDown(bodyField(), { key: 'b', ctrlKey: true })
    const spans = [
      ...document.querySelectorAll('[data-caret-run-overlay] span'),
    ].filter((span): span is HTMLElement => span instanceof HTMLElement)
    expect(spans.some((span) => span.style.fontWeight === '700')).toBe(true)
  })

  it('does not claim the chord inside a foreign form field', () => {
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')

    fireEvent.keyDown(bodyField(), { key: 'b', ctrlKey: true })
    expect(pressed('Bold')).toBe('true')
    fireEvent.keyDown(bodyField(), { key: 'b', ctrlKey: true })
    expect(pressed('Bold')).toBe('false')

    // The find box is a foreign field inside the workspace shell: its own
    // Ctrl+B must not reach the document control.
    openRibbonTab('Review')
    const find = screen.getByLabelText('Find in document')
    fireEvent.keyDown(find, { key: 'b', ctrlKey: true })
    openRibbonTab('Home')
    expect(pressed('Bold')).toBe('false')
  })
})
