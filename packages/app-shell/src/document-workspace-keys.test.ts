import { describe, expect, it, vi } from 'vitest'
import { handleDocumentWorkspaceKeys } from './document-workspace-keys'

function event(key: string, extras: { shiftKey?: boolean } = {}) {
  return {
    key,
    metaKey: false,
    ctrlKey: true,
    shiftKey: extras.shiftKey ?? false,
    preventDefault: vi.fn(),
  }
}

describe('document workspace keys', () => {
  it('routes save, undo, and find without treating redo as undo', () => {
    const save = vi.fn()
    const undo = vi.fn()
    const focusFind = vi.fn()
    const handlers = { save, undo, focusFind }

    const saveEvent = event('s')
    handleDocumentWorkspaceKeys(saveEvent, handlers)
    expect(saveEvent.preventDefault).toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)

    const undoEvent = event('z')
    handleDocumentWorkspaceKeys(undoEvent, handlers)
    expect(undo).toHaveBeenCalledTimes(1)

    handleDocumentWorkspaceKeys(event('z', { shiftKey: true }), handlers)
    expect(undo).toHaveBeenCalledTimes(1)

    const findEvent = event('f')
    handleDocumentWorkspaceKeys(findEvent, handlers)
    expect(findEvent.preventDefault).toHaveBeenCalled()
    expect(focusFind).toHaveBeenCalledTimes(1)
  })
})
