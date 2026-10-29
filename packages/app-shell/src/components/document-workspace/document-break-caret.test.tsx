import '@obiter/test-dom'
import { command } from './editor-test-commands'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../../../scripts/test/vitest-compat'
import type { DocumentEditOperation } from '@obiter/contracts'
import { openRibbonTab } from './editor-test-commands'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
} from './docx-workspace-harness'

import { bodyField, clickParagraph } from './paragraph-selection-harness'

function breakModel() {
  return multiParagraphModel([
    paragraph('p1', '0123456789abcdefghijklmnopqrstuvwxyz'),
    paragraph('p2', 'tail'),
  ])
}

function insertBreakOperations(
  editAsync: ReturnType<typeof vi.fn>,
): Extract<DocumentEditOperation, { type: 'insert_break' }>[] {
  const call = editAsync.mock.calls[0]?.[0] as
    { operations?: DocumentEditOperation[] } | undefined
  return (call?.operations ?? []).filter(
    (
      operation,
    ): operation is Extract<DocumentEditOperation, { type: 'insert_break' }> =>
      operation.type === 'insert_break',
  )
}

function save(editAsync: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  return waitFor(() => expect(editAsync).toHaveBeenCalled())
}

describe('page break caret placement', () => {
  it('places the break at a mouse-placed offset after the editor mounts', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: breakModel() }, editAsync })
    openRibbonTab('Insert')
    clickParagraph('p1', 10)
    fireEvent.click(command('Page break'))

    await save(editAsync)
    expect(insertBreakOperations(editAsync)).toEqual([
      { type: 'insert_break', paragraphId: 'p1', offset: 10, kind: 'page' },
    ])
  })

  it('keeps the resolved caret across a second page break insert', async () => {
    const editAsync = vi.fn().mockResolvedValue({ versionId: 'ver_2' })
    mountWorkspace({ models: { doc_1: breakModel() }, editAsync })
    clickParagraph('p1')
    const field = bodyField()
    field.setSelectionRange(10, 10)
    fireEvent.click(field)
    openRibbonTab('Insert')

    fireEvent.click(command('Page break'))
    fireEvent.click(command('Page break'))

    await save(editAsync)
    const offsets = insertBreakOperations(editAsync).map(
      (operation) => operation.offset,
    )
    expect(offsets.length).toBeGreaterThan(0)
    expect(offsets).not.toContain(0)
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
  })
})
