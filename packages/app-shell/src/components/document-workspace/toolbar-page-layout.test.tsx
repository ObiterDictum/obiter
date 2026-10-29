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
import { commandDisabled, openRibbonTab } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  command,
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
  fireEvent.click(command('Save'))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

/**
 * The value selects are Base UI Selects. Applying a preset through one is a
 * browser journey (opening a portaled listbox, picking a row) and is covered
 * end to end by document-page-layout.spec.ts, which asserts the stored page
 * setup after a reload. What jsdom can prove without the popup is the state a
 * reader sees when the control cannot run at all.
 */
function select(name: string): HTMLElement {
  return screen.getByRole('combobox', { name })
}

describe('the page setup controls', () => {
  it('toggles orientation and reflects it as pressed', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })

    openRibbonTab('Layout')
    fireEvent.click(command('Orientation'))
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

  it('disables page setup while tracked changes are on', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    fireEvent.click(screen.getByRole('switch', { name: 'Track changes' }))
    openRibbonTab('Layout')
    // A tracked page-setup change cannot be represented, so the controls say
    // so by being unavailable rather than by applying something silently.
    for (const name of ['Margins', 'Page size']) {
      expect((select(name) as HTMLButtonElement).disabled).toBe(true)
    }
    expect(screen.getByRole('button', { name: 'Orientation' })).toHaveProperty(
      'disabled',
      true,
    )
  })
})

describe('the break controls', () => {
  it('inserts a page break at the caret and saves it', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')

    openRibbonTab('Insert')
    fireEvent.click(command('Page break'))

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
    fireEvent.click(command('Page break'))

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
    fireEvent.click(command('Section break'))

    await save(editAsync)
    expect(operations(editAsync, 'insert_section_break')).toEqual([
      { type: 'insert_section_break', paragraphId: 'p2' },
    ])
  })

  it('disables a break when the caret is not in a paragraph', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    openRibbonTab('Insert')
    expect(commandDisabled(command('Page break'))).toBe(true)
  })
})
