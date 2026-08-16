// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { handleDocumentWorkspaceKeys } from './document-workspace-keys'

function event(
  key: string,
  extras: { shiftKey?: boolean; target?: EventTarget | null } = {},
) {
  return {
    key,
    metaKey: false,
    ctrlKey: true,
    shiftKey: extras.shiftKey ?? false,
    preventDefault: vi.fn(),
    target: extras.target,
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

  it('does not intercept undo or find inside the find and comments fields', () => {
    const undo = vi.fn()
    const focusFind = vi.fn()
    const handlers = { save: vi.fn(), undo, focusFind }

    for (const field of [
      document.createElement('input'),
      document.createElement('textarea'),
    ]) {
      vi.clearAllMocks()
      const undoEvent = event('z', { target: field })
      handleDocumentWorkspaceKeys(undoEvent, handlers)
      expect(undo).not.toHaveBeenCalled()
      expect(undoEvent.preventDefault).not.toHaveBeenCalled()

      const findEvent = event('f', { target: field })
      handleDocumentWorkspaceKeys(findEvent, handlers)
      expect(focusFind).not.toHaveBeenCalled()
      expect(findEvent.preventDefault).not.toHaveBeenCalled()
    }
  })

  it('still routes save from inside a non-paragraph field', () => {
    const save = vi.fn()
    handleDocumentWorkspaceKeys(
      event('s', { target: document.createElement('textarea') }),
      {
        save,
      },
    )
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('still routes undo from a paragraph editor field', () => {
    const undo = vi.fn()
    const editor = document.createElement('textarea')
    const paragraph = document.createElement('div')
    paragraph.setAttribute('data-paragraph-id', 'p1')
    paragraph.appendChild(editor)

    const undoEvent = event('z', { target: editor })
    handleDocumentWorkspaceKeys(undoEvent, { save: vi.fn(), undo })
    expect(undo).toHaveBeenCalledTimes(1)
    expect(undoEvent.preventDefault).toHaveBeenCalled()
  })
})
