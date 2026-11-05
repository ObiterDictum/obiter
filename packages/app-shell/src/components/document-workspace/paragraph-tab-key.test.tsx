import '@obiter/test-dom'
import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import {
  command,
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  tabledBodyModel,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
  placeCaret,
} from './paragraph-selection-harness'

const paragraphModel = () =>
  multiParagraphModel([paragraph('p1', 'Alpha'), paragraph('p2', 'Bravo')])

function mount(model = paragraphModel()) {
  const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
  mountWorkspace({ models: { doc_1: model }, editAsync })
  return { editAsync }
}

function saveOperations(editAsync: ReturnType<typeof vi.fn>) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: Array<Record<string, unknown>> } | undefined
  return call?.operations ?? []
}

function save() {
  fireEvent.click(command('Save'))
}

function tab(options: { shiftKey?: boolean } = {}) {
  return fireEvent.keyDown(bodyField(), { key: 'Tab', ...options })
}

describe('Tab in body text', () => {
  it('inserts a tab at the caret and saves it inside the run', () => {
    const { editAsync } = mount()
    clickParagraph('p1')
    placeCaret(2)
    expect(tab()).toBe(false)
    expect(bodyField().value).toBe('Al\tpha')
    expect(bodyField().selectionStart).toBe(3)
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'Al\tpha' },
    ])
  })

  it('replaces the selected range with a tab the way typing does', () => {
    const { editAsync } = mount()
    clickParagraph('p1')
    nativeSelect(1, 4)
    tab()
    expect(bodyField().value).toBe('A\ta')
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: 'A\ta' },
    ])
  })

  it('keeps a lone tab in an otherwise emptied paragraph', () => {
    const { editAsync } = mount()
    clickParagraph('p1')
    nativeSelect(0, 5)
    tab()
    expect(bodyField().value).toBe('\t')
    save()
    expect(saveOperations(editAsync)).toEqual([
      { type: 'replace_run_text', runId: 'p1-r', text: '\t' },
    ])
  })

  it('paints the inserted tab up to the next default stop', () => {
    mount()
    clickParagraph('p1')
    placeCaret(2)
    tab()
    const stop = Number(
      document.querySelector('[data-tab-stop]')?.getAttribute('data-tab-stop'),
    )
    expect(stop).toBeGreaterThan(0)
    expect(stop % 48).toBe(0)
  })

  it('paints the inserted tab up to a stop set on the paragraph', () => {
    mount(
      multiParagraphModel([
        {
          id: 'p1',
          runs: [{ id: 'p1-r', text: 'Alpha', preservedXmlFragments: [] }],
          preservedXmlFragments: [
            '<w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>',
          ],
        },
      ]),
    )
    clickParagraph('p1')
    placeCaret(2)
    tab()
    expect(
      document.querySelector('[data-tab-stop]')?.getAttribute('data-tab-stop'),
    ).toBe('96')
  })

  it('leaves the text and the focus alone on Shift+Tab', () => {
    const { editAsync } = mount()
    clickParagraph('p1')
    placeCaret(2)
    expect(tab({ shiftKey: true })).toBe(false)
    expect(bodyField().value).toBe('Alpha')
    expect(document.activeElement).toBe(bodyField())
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('leaves Tab to cell navigation inside a table cell', () => {
    const { editAsync } = mount(tabledBodyModel())
    clickParagraph('para-w14-CELL0001')
    placeCaret(2)
    expect(tab()).toBe(true)
    expect(tab({ shiftKey: true })).toBe(true)
    expect(bodyField().value).toBe('Cell one')
    save()
    expect(editAsync).not.toHaveBeenCalled()
  })

  it('undoes and redoes an inserted tab', () => {
    mount()
    clickParagraph('p1')
    placeCaret(5)
    tab()
    expect(bodyField().value).toBe('Alpha\t')
    fireEvent.click(command('Undo'))
    expect(bodyField().value).toBe('Alpha')
    fireEvent.click(command('Redo'))
    expect(bodyField().value).toBe('Alpha\t')
  })

  it('leaves the editor on Escape so Tab can move focus out', () => {
    mount()
    clickParagraph('p1')
    placeCaret(2)
    expect(fireEvent.keyDown(bodyField(), { key: 'Escape' })).toBe(false)
    expect(
      document.querySelector('textarea[aria-label="Paragraph text"]'),
    ).toBe(null)
    expect(fireEvent.keyDown(document.body, { key: 'Tab' })).toBe(true)
  })
})
