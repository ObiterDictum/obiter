import '@obiter/test-dom'
/*
 * E5 break placement from the caret. A mouse-placed offset must survive the
 * editor remount that pagination causes, so a page break lands where the
 * pointer was and a second click does not fall back to the paragraph start.
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
    // Clicking into the body text of an unfocused paragraph mounts its editor;
    // that focus must not drop the offset the pointer carried.
    clickParagraph('p1', 10)
    fireEvent.click(screen.getByRole('button', { name: 'Page break' }))

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

    fireEvent.click(screen.getByRole('button', { name: 'Page break' }))
    fireEvent.click(screen.getByRole('button', { name: 'Page break' }))

    await save(editAsync)
    const offsets = insertBreakOperations(editAsync).map(
      (operation) => operation.offset,
    )
    // The first insert splits the paragraph and remounts the editor; the caret
    // stays resolved, so the second click is the same offset (deduplicated)
    // rather than a silent break at the paragraph start.
    expect(offsets.length).toBeGreaterThan(0)
    expect(offsets).not.toContain(0)
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
  })
})
