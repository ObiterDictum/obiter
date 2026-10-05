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
  tabledBodyModel,
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

function pendingField(): HTMLTextAreaElement {
  const node = screen.getByLabelText('Pending paragraph text')
  if (!(node instanceof HTMLTextAreaElement)) {
    throw new Error('expected a pending insert editor')
  }
  return node
}

function pendingFields(): HTMLTextAreaElement[] {
  return screen.getAllByLabelText('Pending paragraph text').map((node) => {
    if (!(node instanceof HTMLTextAreaElement)) {
      throw new Error('expected a pending insert editor')
    }
    return node
  })
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
    expect(pendingField().value).toBe('B')

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

  it('splits a native multi-paragraph paste inside a pending insert', async () => {
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    fireEvent.click(control('Insert paragraph'))
    const pending = pendingField()
    await waitFor(() => expect(document.activeElement).toBe(pending))

    fireEvent.paste(pending, {
      clipboardData: { getData: () => 'A\nB' },
    })

    // The insert splits into two pending paragraphs, not one with a hard break.
    await waitFor(() => expect(renderedParagraphIds()).toHaveLength(4))
    expect(pendingFields().map((field) => field.value)).toEqual(['A', 'B'])

    // One paste is one history step: a single undo restores the pre-paste
    // insert rather than leaving the two the paste created.
    fireEvent.click(control('Undo'))
    expect(renderedParagraphIds()).toHaveLength(3)
    expect(screen.getAllByLabelText('Pending paragraph text')).toHaveLength(1)
  })

  it('does not treat a stale selection as live when pasting into a pending insert', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('Z') })
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    fireEvent.click(control('Insert paragraph'))
    fireEvent.change(pendingField(), { target: { value: 'ab' } })

    // Select in the body paragraph so its format range is live, then click into
    // the insert: that click must reseat the range on the insert's own caret,
    // not leave the body paragraph's range as a phantom the ribbon paste
    // replaces. The insert must keep both characters.
    clickParagraph('p1')
    nativeSelect(1, 4)
    fireEvent.click(pendingField())

    fireEvent.click(control('Paste'))
    await waitFor(() => expect(pendingField().value).toBe('abZ'))
  })

  it('drops onto an unfocused pending insert, not the live selection', async () => {
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    fireEvent.click(control('Insert paragraph'))
    // Select in the body paragraph again, so the insert is rendered but not the
    // selected paragraph: a drop on it must target the insert, not the range.
    clickParagraph('p1')
    nativeSelect(1, 4)

    fireEvent.drop(pendingField(), { dataTransfer: { getData: () => 'Z' } })

    await waitFor(() => expect(pendingField().value).toBe('Z'))
    // The body paragraph's text is untouched: the drop did not replace its
    // live selection with the payload.
    expect(
      document.querySelector('[data-paragraph-id="p1"]')?.textContent ?? '',
    ).toContain('Hello')
  })

  it('refuses a multi-line ribbon paste into a table cell', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('A\nB') })
    mountWorkspace({ models: { doc_1: tabledBodyModel() } })
    clickParagraph('para-w14-CELL0001')
    const before = renderedParagraphIds().length

    fireEvent.click(control('Paste'))
    // A split there would render siblings as body text while the save writes
    // them inside the cell, so it is refused with the structure reason.
    await waitFor(() =>
      expect(selectionStatus()).toMatch(/cannot cross a table/),
    )
    expect(renderedParagraphIds()).toHaveLength(before)
    expect(screen.queryByLabelText('Pending paragraph text')).toBeNull()
  })

  it('says why when the clipboard read is denied', async () => {
    stubClipboard({ readText: vi.fn().mockRejectedValue(new Error('denied')) })
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')

    fireEvent.click(control('Paste'))
    await waitFor(() =>
      expect(selectionStatus()).toMatch(/clipboard could not be read/i),
    )
  })

  it('says why when the clipboard write is denied', async () => {
    stubClipboard({
      writeText: vi.fn().mockRejectedValue(new Error('denied')),
    })
    mountWorkspace({ models: { doc_1: model() } })
    clickParagraph('p1')
    nativeSelect(1, 3)

    fireEvent.click(control('Copy'))
    await waitFor(() =>
      expect(selectionStatus()).toMatch(/clipboard could not be written/i),
    )
    expect(bodyField().value).toBe('Hello')
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
