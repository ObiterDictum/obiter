import '@obiter/test-dom'
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
    fireEvent.click(screen.getByRole('switch', { name: 'Track changes' }))
    openRibbonTab('Home')
    clickParagraph('p1')

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
