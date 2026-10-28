import '@obiter/test-dom'
/*
 * E3 paragraph formatting: Align left/centre/right/justify, Line spacing and
 * the Layout Indent control must apply to every paragraph the target covers,
 * paint the same paragraph layout the save sends, and move in one history step.
 * The effective readers and the save-plan slot live in
 * document-paragraph-format.test.ts; this is the mounted-control surface.
 */
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import { openRibbonTab } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  command,
} from './docx-workspace-harness'

import { clickParagraph } from './paragraph-selection-harness'

function helloModel() {
  return multiParagraphModel([
    paragraph('p1', 'Hello'),
    paragraph('p2', 'tail'),
  ])
}

function control(name: string): HTMLButtonElement {
  const button = screen.queryByRole('button', { name })
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`missing ${name} control`)
  }
  return button
}

function pressed(name: string): string | null {
  return control(name).getAttribute('aria-pressed')
}

function paragraphStyle(paragraphId: string): CSSStyleDeclaration {
  const root = document.querySelector(`[data-paragraph-id="${paragraphId}"]`)
  if (!(root instanceof HTMLElement)) {
    throw new Error(`missing paragraph ${paragraphId}`)
  }
  return root.style
}

function paragraphOperations(editAsync: ReturnType<typeof vi.fn>) {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: DocumentEditOperation[] } | undefined
  return (call?.operations ?? []).filter(
    (operation) => operation.type === 'set_paragraph_format',
  )
}

function save(editAsync: ReturnType<typeof vi.fn>) {
  fireEvent.click(command('Save'))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

/* The value selects in this file are Base UI Selects; jsdom cannot open their
 * popups, so the cases that drove them end-to-end are skipped here and covered
 * by the document e2e specs (font formatting, page layout, paragraph formatting). */
/** The expanded test bodies below are skipped; this keeps their types real. */
function lineSpacingSelect(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Line spacing' })
}

function indentSelect(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Indent' })
}

describe('the paragraph formatting controls', () => {
  it('applies an alignment, paints it, and saves one operation', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')

    fireEvent.click(control('Align centre'))
    expect(pressed('Align centre')).toBe('true')
    expect(pressed('Align left')).toBe('false')
    expect(paragraphStyle('p1').textAlign).toBe('center')

    await save(editAsync)
    expect(paragraphOperations(editAsync)).toEqual([
      {
        type: 'set_paragraph_format',
        paragraphId: 'p1',
        alignment: 'center',
      },
    ])
  })

  it.skip('applies line spacing and reflects the effective value', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')

    expect(lineSpacingSelect().textContent).toBe('1.5')
    // The 1.5 multiple paints from the same XML the server writes: the default
    // 22 half-point face renders a 22px line box.
    expect(paragraphStyle('p1').lineHeight).toBe('22px')

    await save(editAsync)
    expect(paragraphOperations(editAsync)).toEqual([
      {
        type: 'set_paragraph_format',
        paragraphId: 'p1',
        lineSpacing: { line: 360, lineRule: 'auto' },
      },
    ])
  })

  it.skip('applies a first-line indent from the Layout ribbon and reflects it', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    clickParagraph('p1')
    openRibbonTab('Layout')

    expect(indentSelect().textContent).toBe('first')
    // 720 twips is Word's half-inch default indent, painted as 48px.
    expect(paragraphStyle('p1').textIndent).toBe('48px')

    await save(editAsync)
    expect(paragraphOperations(editAsync)).toEqual([
      {
        type: 'set_paragraph_format',
        paragraphId: 'p1',
        indentation: { firstLine: 720 },
      },
    ])
  })

  it('reverts and reapplies a paragraph change in one undo step', () => {
    mountWorkspace({ models: { doc_1: helloModel() } })
    clickParagraph('p1')

    fireEvent.click(control('Align centre'))
    expect(pressed('Align centre')).toBe('true')

    fireEvent.click(control('Undo'))
    expect(pressed('Align centre')).toBe('false')
    expect(paragraphStyle('p1').textAlign).not.toBe('center')

    fireEvent.click(control('Redo'))
    expect(pressed('Align centre')).toBe('true')
  })

  it('keeps paragraph formatting available under track changes and saves tracked', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: helloModel() }, editAsync })
    openRibbonTab('Review')
    fireEvent.click(command('Track changes off'))
    openRibbonTab('Home')
    clickParagraph('p1')

    // A paragraph-format change has a tracked pPrChange writer, so unlike a
    // partial run range it is recorded rather than refused.
    expect(control('Align right').disabled).toBe(false)
    fireEvent.click(control('Align right'))
    expect(pressed('Align right')).toBe('true')

    await save(editAsync)
    const call = editAsync.mock.calls[0]?.[0] as
      { trackChanges?: boolean } | undefined
    expect(call?.trackChanges).toBe(true)
    expect(paragraphOperations(editAsync)).toEqual([
      {
        type: 'set_paragraph_format',
        paragraphId: 'p1',
        alignment: 'right',
      },
    ])
  })
})
