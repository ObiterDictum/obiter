import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  insertParagraphRuns,
  type DocumentEditOperation,
} from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  rerenderWorkspace,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
  placeCaret,
  selectedText,
  selectionStatus,
} from './paragraph-selection-harness'

const threeParagraphs = () =>
  multiParagraphModel([
    paragraph('p1', 'Alpha'),
    paragraph('p2', 'Bravo'),
    paragraph('p3', 'Charlie'),
  ])

function mount(model = threeParagraphs()) {
  const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
  const view = mountWorkspace({ models: { doc_1: model }, editAsync })
  return { view, editAsync }
}

/**
 * Selects from p1 offset 2 to p2 offset 2: a native in-paragraph selection
 * extended one step across the boundary and two model-owned steps inside it.
 */
function selectAcrossBoundary() {
  clickParagraph('p1')
  nativeSelect(2, 5)
  fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
  fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
  fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
  expect(selectionStatus()).toMatch(/2 paragraphs selected/)
}

function saveOperations(editAsync: ReturnType<typeof vi.fn>) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: Array<Record<string, unknown>> } | undefined
  return call?.operations ?? []
}

function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('editing across a cross-paragraph selection', () => {
  it('deletes the exact range on Backspace', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.keyDown(bodyField(), { key: 'Backspace' })
    expect(selectionStatus()).toBe('')
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Alavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('deletes the same range on Delete', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.keyDown(bodyField(), { key: 'Delete' })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Alavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('replaces the range with a typed character', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.keyDown(bodyField(), { key: 'X' })
    save()
    // p1 keeps its head, the selection is replaced by X, and p2's tail joins.
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'AlXavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('edits from the collapsed caret after a modified arrow', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    // Ctrl+Arrow moves natively; the model collapses first so the two agree.
    fireEvent.keyDown(bodyField(), { key: 'ArrowRight', ctrlKey: true })
    expect(selectionStatus()).toBe('')
    // The ordered end of the range is p2 offset 2, so typing must extend p2
    // rather than replace the range that was selected a moment ago.
    fireEvent.change(bodyField(), { target: { value: 'BraXvo' } })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p2-r', text: 'BraXvo' },
    ])
  })

  it('applies a non-keydown change as a replacement of the range', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    // A change that reaches the field without a key event (an IME commit, a
    // drop, a paste path the key handler missed) is the inserted text that
    // replaces the whole range, not an edit of one paragraph of it.
    fireEvent.change(bodyField(), { target: { value: 'X' } })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'AlXavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('refuses a non-keydown change that only removes text', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.change(bodyField(), { target: { value: '' } })
    // A pure deletion through the value cannot be expressed as a replacement,
    // so it is refused with a spoken reason rather than silently discarded.
    expect(selectionStatus()).toMatch(/cannot replace a document selection/)
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('replaces the range with a paragraph break on Enter', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.keyDown(bodyField(), { key: 'Enter' })
    save()
    const operations = saveOperations(editAsync)
    expect(operations[0]).toEqual({
      type: 'replace_run_text',
      runId: 'p1-r',
      text: 'Al',
    })
    const inserted = operations[1] as Extract<
      DocumentEditOperation,
      { type: 'insert_paragraph_after' }
    >
    expect(inserted.type).toBe('insert_paragraph_after')
    expect(inserted.paragraphId).toBe('p1')
    expect(
      insertParagraphRuns(inserted)
        .map((run) => run.text)
        .join(''),
    ).toBe('avo')
    expect(operations[2]).toEqual({
      type: 'delete_paragraph',
      paragraphId: 'p2',
    })
  })

  it('copies the selection as plain text with paragraph breaks', () => {
    mount()
    selectAcrossBoundary()
    const setData = vi.fn()
    fireEvent.copy(bodyField(), { clipboardData: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', 'pha\nBr')
  })

  it('cuts the selection after writing it to the clipboard', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    const setData = vi.fn()
    fireEvent.cut(bodyField(), { clipboardData: { setData } })
    expect(setData).toHaveBeenCalledWith('text/plain', 'pha\nBr')
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Alavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('pastes over the selection as plain text', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.paste(bodyField(), {
      clipboardData: { getData: () => 'zed' },
    })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Alzedavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('keeps the edit through save and reload', async () => {
    const models = { doc_1: threeParagraphs() }
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    const view = mountWorkspace({ models, editAsync })
    selectAcrossBoundary()
    fireEvent.keyDown(bodyField(), { key: 'Backspace' })
    save()
    await vi.waitFor(() => expect(editAsync).toHaveBeenCalled())

    // The saved version comes back with the range applied.
    models.doc_1 = multiParagraphModel([
      paragraph('p1', 'Alavo'),
      paragraph('p3', 'Charlie'),
    ])
    rerenderWorkspace(view, 'doc_1')
    // The reloaded paragraph is painted twice — the overlay span and the
    // textarea both carry the text (jsdom exposes a textarea's value as its
    // text content), so getByText is ambiguous by construction here.
    expect(screen.getAllByText('Alavo').length).toBeGreaterThan(0)
    expect(screen.queryByText('Bravo')).toBeNull()
    expect(selectionStatus()).toBe('')
    expect(document.querySelectorAll('[data-selected-text]')).toHaveLength(0)
  })
})

describe('formatting a cross-paragraph selection', () => {
  it('queues one emphasis range per selected paragraph', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    save()
    expect(saveOperations(editAsync)).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 2,
        to: 5,
        bold: true,
      },
      {
        type: 'set_run_emphasis',
        paragraphId: 'p2',
        from: 0,
        to: 2,
        bold: true,
      },
    ])
  })

  it('applies whole-run emphasis when there is no selection', () => {
    const { editAsync } = mount()
    clickParagraph('p1')
    placeCaret(2)
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'set_run_emphasis', runId: 'p1-r', bold: true },
    ])
  })

  it('fails closed with tracked changes on instead of partial formatting', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.click(screen.getByRole('tab', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Track changes off' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Home' }))

    const bold = screen.getByRole('button', {
      name: 'Bold: Partial formatting is not yet recorded as a tracked change',
    })
    expect(bold).toHaveProperty('disabled', true)
    fireEvent.click(bold)
    // Nothing was applied to one paragraph of the selection.
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty(
      'disabled',
      true,
    )
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('applies a paragraph style to every selected paragraph', () => {
    const model = threeParagraphs()
    model.styles = [
      {
        styleId: 'Quote',
        sourceFragment:
          '<w:style w:type="paragraph"><w:name w:val="Quote"/></w:style>',
      },
    ]
    const { editAsync } = mount(model)
    selectAcrossBoundary()
    fireEvent.change(screen.getByLabelText('Paragraph style'), {
      target: { value: 'Quote' },
    })
    save()
    const operations = saveOperations(editAsync)
    expect(operations).toEqual(
      expect.arrayContaining([
        { type: 'set_paragraph_style', paragraphId: 'p1', styleId: 'Quote' },
        { type: 'set_paragraph_style', paragraphId: 'p2', styleId: 'Quote' },
      ]),
    )
    expect(operations).toHaveLength(2)
  })
})

describe('a formatted tail keeps its formatting through the join', () => {
  function formattedTailModel() {
    return multiParagraphModel([
      paragraph('p1', 'Alpha'),
      {
        id: 'p2',
        runs: [
          { id: 'p2-a', text: 'Br', preservedXmlFragments: [] },
          {
            id: 'p2-b',
            text: 'av',
            preservedXmlFragments: ['<w:rPr><w:i/></w:rPr>'],
          },
          {
            id: 'p2-c',
            text: 'o',
            preservedXmlFragments: ['<w:rPr><w:b/></w:rPr>'],
          },
        ],
        preservedXmlFragments: [],
      },
    ])
  }

  it('queues an emphasis range for each appended run that differs', () => {
    const { editAsync } = mount(formattedTailModel())
    selectAcrossBoundary()
    fireEvent.keyDown(bodyField(), { key: 'Backspace' })
    save()
    const operations = saveOperations(editAsync)
    // The italic tail run and the bold tail run are restated over their slices
    // of the merged paragraph, so the save keeps what the editor painted.
    expect(operations).toContainEqual(
      expect.objectContaining({
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 2,
        to: 4,
        italic: true,
      }),
    )
    expect(operations).toContainEqual(
      expect.objectContaining({
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 4,
        to: 5,
        bold: true,
        italic: null,
      }),
    )
  })

  it('refuses a tail it cannot restate rather than saving a plainer one', () => {
    const model = multiParagraphModel([
      paragraph('p1', 'Alpha'),
      {
        id: 'p2',
        runs: [
          {
            id: 'p2-r',
            text: 'Bravo',
            preservedXmlFragments: [],
            styleId: 'Emphasis',
          },
        ],
        preservedXmlFragments: [],
      },
    ])
    const { editAsync } = mount(model)
    selectAcrossBoundary()
    fireEvent.keyDown(bodyField(), { key: 'Backspace' })
    // The join cannot carry the tail's character style, so nothing changes and
    // the reason is announced.
    expect(selectionStatus()).toMatch(/cannot save/)
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })
})

describe('cut ordering and non-keydown input', () => {
  it('does not write the clipboard when the range edit is refused', () => {
    const model = multiParagraphModel([
      paragraph('p1', 'Alpha'),
      {
        id: 'p2',
        runs: [
          {
            id: 'p2-r',
            text: 'Bravo',
            preservedXmlFragments: [],
            styleId: 'Emphasis',
          },
        ],
        preservedXmlFragments: [],
      },
    ])
    const { editAsync } = mount(model)
    selectAcrossBoundary()
    const setData = vi.fn()
    fireEvent.cut(bodyField(), { clipboardData: { setData } })
    expect(setData).not.toHaveBeenCalled()
    expect(selectionStatus()).toMatch(/cannot save/)
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('leaves the text in place when the clipboard cannot be written', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    const setData = vi.fn(() => {
      throw new Error('clipboard denied')
    })
    fireEvent.cut(bodyField(), { clipboardData: { setData } })
    expect(setData).toHaveBeenCalled()
    expect(selectionStatus()).toMatch(/clipboard could not be written/)
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('replaces the range with dropped text', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.drop(bodyField(), {
      dataTransfer: { getData: () => 'zed' },
    })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Alzedavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('refuses an empty drop with a reason rather than swallowing it', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.drop(bodyField(), { dataTransfer: { getData: () => '' } })
    expect(selectionStatus()).toMatch(/cannot replace a document selection/)
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('applies an IME commit once as a range replacement', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    const field = bodyField()
    // Synthetic composition events, not a real OS IME pass: the commit is the
    // value the field holds when composition ends.
    fireEvent.compositionStart(field)
    // A change during the composition is not the commit and is not applied.
    fireEvent.change(field, { target: { value: 'Z' } })
    field.value = 'X'
    fireEvent.compositionEnd(field)
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'AlXavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })
})

describe('pasting over a document selection', () => {
  // An empty clipboard and an image-only or format-only copy arrive as the
  // same absent text/plain payload, and the editor collapses both to ''
  // before its length check, so one input models both refusals.
  it('refuses an empty or text-less clipboard instead of deleting the selection', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.paste(bodyField(), { clipboardData: { getData: () => '' } })
    expect(selectionStatus()).toMatch(/cannot replace a document selection/)
    // The range is still live, painted, and untouched.
    expect(selectedText('p1')).toBe('pha')
    expect(selectedText('p2')).toBe('Br')
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('accepts a whitespace-only payload rather than treating it as empty', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.paste(bodyField(), { clipboardData: { getData: () => '   ' } })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Al   avo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('accepts a newline-only payload', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.paste(bodyField(), { clipboardData: { getData: () => '\n' } })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Al\navo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('replaces the range with an astral character', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    fireEvent.paste(bodyField(), {
      clipboardData: { getData: () => '\u{1f600}' },
    })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Al\u{1f600}avo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })

  it('applies one replacement when a paste is followed by an input event', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    const field = bodyField()
    fireEvent.paste(field, { clipboardData: { getData: () => 'zed' } })
    // The paste path preventDefaults, so a browser that still dispatches the
    // input event must not insert the same text a second time.
    fireEvent.change(field, { target: { value: 'Alzedavo' } })
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Alzedavo' },
      { type: 'delete_paragraph', paragraphId: 'p2' },
    ])
  })
})

describe('an unsaved inserted paragraph blocks a selection', () => {
  it('refuses to extend into the inserted paragraph', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    // Enter after p1 creates the pending paragraph and moves the caret into it.
    fireEvent.keyDown(bodyField(), { key: 'Enter' })
    clickParagraph('p1')
    placeCaret(5)
    fireEvent.keyDown(bodyField(), { key: 'ArrowRight', shiftKey: true })
    expect(selectionStatus()).toMatch(
      /cannot cross an unsaved inserted paragraph/,
    )
    expect(selectedText('p1')).toBe('')
  })

  it('refuses select all rather than leaving the paragraph unpainted', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    fireEvent.keyDown(bodyField(), { key: 'Enter' })
    clickParagraph('p1')
    fireEvent.keyDown(bodyField(), { key: 'a', ctrlKey: true })
    expect(selectionStatus()).toMatch(
      /cannot cross an unsaved inserted paragraph/,
    )
    expect(document.querySelectorAll('[data-selected-text]')).toHaveLength(0)
  })
})
