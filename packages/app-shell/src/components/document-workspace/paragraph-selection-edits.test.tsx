// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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

  it('does not apply a text change that slips past the key handler', () => {
    const { editAsync } = mount()
    selectAcrossBoundary()
    // Whatever produced it, a change arriving with a document selection must
    // not be applied to one paragraph of it.
    fireEvent.change(bodyField(), { target: { value: 'Al' } })
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
    expect(screen.getByText('Alavo')).toBeTruthy()
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
