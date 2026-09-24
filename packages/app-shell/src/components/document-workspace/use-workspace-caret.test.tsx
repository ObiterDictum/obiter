import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import type { WrappedLine } from '../../document-page-flow'
import { armVerticalDelivery, retainVerticalColumn } from './paragraph-arrow'
import { useWorkspaceCaret } from './use-workspace-caret'
import { useWorkspaceDrafts } from './use-workspace-drafts'

const lines = (...spans: Array<[number, number]>): WrappedLine[] =>
  spans.map(([from, to]) => ({ text: 'x'.repeat(to - from), from, to }))

function useCaretHarness(documentId: string) {
  const drafts = useWorkspaceDrafts({
    organisationId: 'org_1',
    userId: 'usr_1',
    documentId,
    baseVersionId: 'ver_1',
  })
  return useWorkspaceCaret({ documentId, model: undefined, drafts })
}

function armColumn(
  result: { current: ReturnType<typeof useWorkspaceCaret> },
  delivery: { paragraphId: string; offset: number },
) {
  act(() => {
    retainVerticalColumn(result.current.verticalCaret, lines([0, 60]), 40)
    armVerticalDelivery(result.current.verticalCaret, delivery)
  })
}

describe('useWorkspaceCaret', () => {
  it('keeps the retained column only for the armed paragraph and offset', () => {
    const { result } = renderHook(() => useCaretHarness('doc_1'))
    armColumn(result, { paragraphId: 'p2', offset: 40 })

    act(() => result.current.selectParagraph('p2', 40))
    expect(result.current.verticalCaret.column).toBe(40)

    // A programmatic selection at another offset is not the armed transition
    // and must end the run.
    act(() => result.current.selectParagraph('p2', 5))
    expect(result.current.verticalCaret.column).toBeNull()
  })

  it('clears the retained column for a different destination', () => {
    const { result } = renderHook(() => useCaretHarness('doc_1'))
    armColumn(result, { paragraphId: 'p2', offset: 40 })

    act(() => result.current.selectParagraph('p3', 40))
    expect(result.current.verticalCaret.column).toBeNull()
  })

  it('clears the column and pending delivery when the document changes', () => {
    const { result, rerender } = renderHook(
      ({ documentId }: { documentId: string }) => useCaretHarness(documentId),
      { initialProps: { documentId: 'doc_1' } },
    )
    armColumn(result, { paragraphId: 'p2', offset: 40 })
    expect(result.current.verticalCaret.column).toBe(40)

    rerender({ documentId: 'doc_2' })
    expect(result.current.verticalCaret.column).toBeNull()
    expect(result.current.verticalCaret.pending).toBeNull()
  })
})
