import '@obiter/test-dom'
/*
 * E5 page and section layout: the Layout ribbon's Margins, Orientation and
 * Page size controls, and the Insert ribbon's Page break and Section break
 * controls, must apply to the body section, save one operation each, and move
 * in one history step. The effective readers and the save-plan slots live in
 * document-section-edits.test.ts; this is the mounted-control surface.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import {
  mountWorkspace,
  multiParagraphModel,
  openRibbonTab,
  paragraph,
} from './docx-workspace-harness'
import { clickParagraph, bodyField } from './paragraph-selection-harness'

function helloModel() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

function operations(
  editAsync: ReturnType<typeof vi.fn>,
  type: DocumentEditOperation['type'],
) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: DocumentEditOperation[] } | undefined
  return (call?.operations ?? []).filter((operation) => operation.type === type)
}

function save(editAsync: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

function select(ariaLabel: string): HTMLSelectElement {
  const node = screen.getByLabelText(ariaLabel, { exact: true })
  if (!(node instanceof HTMLSelectElement)) {
    throw new Error(`missing ${ariaLabel} select`)
  }
  return node
}

describe('the page setup controls', () => {
  it('applies a margins preset and saves one section operation', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })

    openRibbonTab('Layout')
    fireEvent.change(select('Margins'), { target: { value: 'narrow' } })
    expect(select('Margins').value).toBe('narrow')

    await save(editAsync)
    expect(operations(editAsync, 'set_section_properties')).toEqual([
      {
        type: 'set_section_properties',
        margins: {
          top: 720,
          right: 720,
          bottom: 720,
          left: 720,
          header: 720,
          footer: 720,
        },
      },
    ])
  })

  it('toggles orientation and reflects it as pressed', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })

    openRibbonTab('Layout')
    fireEvent.click(screen.getByRole('button', { name: 'Orientation' }))
    expect(
      screen
        .getByRole('button', { name: 'Orientation' })
        .getAttribute('aria-pressed'),
    ).toBe('true')

    await save(editAsync)
    expect(operations(editAsync, 'set_section_properties')).toEqual([
      { type: 'set_section_properties', orientation: 'landscape' },
    ])
  })

  it('applies a page size and undoes it in one step', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })

    openRibbonTab('Layout')
    fireEvent.change(select('Page size'), { target: { value: 'legal' } })
    expect(select('Page size').value).toBe('legal')

    openRibbonTab('Home')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    openRibbonTab('Layout')
    expect(select('Page size').value).toBe('')
  })

  it('disables page setup while tracked changes are on', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    openRibbonTab('Review')
    fireEvent.click(screen.getByRole('button', { name: /^Track changes/ }))
    openRibbonTab('Layout')
    const margins = screen.getByLabelText(/^Margins/)
    expect(margins instanceof HTMLSelectElement && margins.disabled).toBe(true)
  })
})

describe('the break controls', () => {
  it('inserts a page break at the caret and saves it', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')

    openRibbonTab('Insert')
    fireEvent.click(screen.getByRole('button', { name: 'Page break' }))

    await save(editAsync)
    expect(operations(editAsync, 'insert_break')).toEqual([
      { type: 'insert_break', paragraphId: 'p1', offset: 0, kind: 'page' },
    ])
  })

  it('inserts a page break at the offset of a mouse-placed caret', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    // Focus the paragraph, then click inside its field so the caret sits at a
    // non-zero offset. A mouse click must carry that offset, not reset to 0.
    clickParagraph('p1')
    const field = bodyField()
    field.setSelectionRange(3, 3)
    fireEvent.click(field)

    openRibbonTab('Insert')
    fireEvent.click(screen.getByRole('button', { name: 'Page break' }))

    await save(editAsync)
    expect(operations(editAsync, 'insert_break')).toEqual([
      { type: 'insert_break', paragraphId: 'p1', offset: 3, kind: 'page' },
    ])
  })

  it('inserts a section break and saves it', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p2')

    openRibbonTab('Insert')
    fireEvent.click(screen.getByRole('button', { name: 'Section break' }))

    await save(editAsync)
    expect(operations(editAsync, 'insert_section_break')).toEqual([
      { type: 'insert_section_break', paragraphId: 'p2' },
    ])
  })

  it('disables a break when the caret is not in a paragraph', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    openRibbonTab('Insert')
    const button = screen.getByRole('button', { name: /^Page break/ })
    expect(button instanceof HTMLButtonElement && button.disabled).toBe(true)
  })
})
