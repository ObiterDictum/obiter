import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import { useWorkspaceDraftHistory } from './document-editor-history'
import type { HistoryEdit } from './document-history-grouping'
import { emptyDraftState, type DraftState } from './document-save-plan'

function state(tag: string): DraftState {
  return { ...emptyDraftState(), drafts: { run: tag } }
}

const typing = (inserted: string): HistoryEdit => ({
  kind: 'typing',
  paragraphId: 'p1',
  inserted,
})

/** Runs a history step inside `act` and hands back what it restored. A closure
 * assignment is not tracked by control flow, so the value rides on an object
 * with its union type written down. */
function restoredBy(step: () => DraftState | null): DraftState | null {
  const captured: { value: DraftState | null } = { value: null }
  act(() => {
    captured.value = step()
  })
  return captured.value
}

describe('useWorkspaceDraftHistory undo grouping', () => {
  it('coalesces consecutive typing into the run it started', () => {
    const { result } = renderHook(() => useWorkspaceDraftHistory())
    act(() => result.current.record(state('0'), typing('a')))
    act(() => result.current.record(state('1'), typing('b')))
    act(() => result.current.record(state('2'), typing('c')))

    // One entry, recorded before the whole run: undo returns the pre-run state.
    const restored = restoredBy(() => result.current.stepBack(state('3')))
    expect(restored?.drafts.run).toBe('0')
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
  })

  it('starts a new entry at a structural edit', () => {
    const { result } = renderHook(() => useWorkspaceDraftHistory())
    act(() => result.current.record(state('0'), typing('a')))
    act(() => result.current.record(state('1'), { kind: 'structural' }))

    // The structural edit's own pre-state is on top, not the run's first.
    const restored = restoredBy(() => result.current.stepBack(state('2')))
    expect(restored?.drafts.run).toBe('1')
  })

  it('closes the run across an undo, so the next keystroke is its own step', () => {
    const { result } = renderHook(() => useWorkspaceDraftHistory())
    act(() => result.current.record(state('0'), typing('a')))
    act(() => result.current.record(state('1'), typing('b')))
    restoredBy(() => result.current.stepBack(state('2')))
    act(() => result.current.record(state('0'), typing('c')))
    act(() => result.current.record(state('0b'), typing('d')))

    const restored = restoredBy(() => result.current.stepBack(state('3')))
    expect(restored?.drafts.run).toBe('0')
  })

  it('keeps redo correct after a grouped run', () => {
    const { result } = renderHook(() => useWorkspaceDraftHistory())
    act(() => result.current.record(state('0'), typing('a')))
    act(() => result.current.record(state('1'), typing('b')))
    restoredBy(() => result.current.stepBack(state('2')))
    const forward = restoredBy(() => result.current.stepForward(state('0')))
    expect(forward?.drafts.run).toBe('2')
  })
})
