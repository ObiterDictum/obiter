import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import { handleDocumentWorkspaceKeys } from './document-workspace-keys'

function event(
  key: string,
  extras: {
    shiftKey?: boolean
    altKey?: boolean
    target?: EventTarget | null
  } = {},
) {
  return {
    key,
    metaKey: false,
    ctrlKey: true,
    shiftKey: extras.shiftKey ?? false,
    altKey: extras.altKey ?? false,
    preventDefault: vi.fn(),
    target: extras.target,
  }
}

describe('document workspace keys', () => {
  it('routes save, undo, redo, and find to their own handlers', () => {
    const save = vi.fn()
    const undo = vi.fn()
    const redo = vi.fn()
    const focusFind = vi.fn()
    const handlers = { save, undo, redo, focusFind }

    const saveEvent = event('s')
    handleDocumentWorkspaceKeys(saveEvent, handlers)
    expect(saveEvent.preventDefault).toHaveBeenCalled()
    expect(save).toHaveBeenCalledTimes(1)

    handleDocumentWorkspaceKeys(event('z'), handlers)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).not.toHaveBeenCalled()

    const shiftZ = event('z', { shiftKey: true })
    handleDocumentWorkspaceKeys(shiftZ, handlers)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(1)
    expect(shiftZ.preventDefault).toHaveBeenCalled()

    handleDocumentWorkspaceKeys(event('y'), handlers)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(2)

    const findEvent = event('f')
    handleDocumentWorkspaceKeys(findEvent, handlers)
    expect(findEvent.preventDefault).toHaveBeenCalled()
    expect(focusFind).toHaveBeenCalledTimes(1)
  })

  it('does not treat redo as undo when no redo handler is wired', () => {
    const undo = vi.fn()
    handleDocumentWorkspaceKeys(event('z', { shiftKey: true }), {
      save: vi.fn(),
      undo,
    })
    handleDocumentWorkspaceKeys(event('y'), { save: vi.fn(), undo })
    expect(undo).not.toHaveBeenCalled()
  })

  it('ignores Alt and AltGr combinations for save, undo and redo', () => {
    const save = vi.fn()
    const undo = vi.fn()
    const redo = vi.fn()
    const handlers = { save, undo, redo }

    // AltGr reports as Ctrl+Alt on Windows, so any Alt-combined chord is a
    // character shortcut for the layout, not a document command.
    const altSave = event('s', { altKey: true })
    handleDocumentWorkspaceKeys(altSave, handlers)
    handleDocumentWorkspaceKeys(event('z', { altKey: true }), handlers)
    handleDocumentWorkspaceKeys(event('y', { altKey: true }), handlers)
    handleDocumentWorkspaceKeys(
      event('z', { altKey: true, shiftKey: true }),
      handlers,
    )
    expect(save).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
    expect(altSave.preventDefault).not.toHaveBeenCalled()

    // The intended bindings still route.
    handleDocumentWorkspaceKeys(event('s'), handlers)
    handleDocumentWorkspaceKeys(event('z'), handlers)
    handleDocumentWorkspaceKeys(event('y'), handlers)
    handleDocumentWorkspaceKeys(event('z', { shiftKey: true }), handlers)
    expect(save).toHaveBeenCalledTimes(1)
    expect(undo).toHaveBeenCalledTimes(1)
    expect(redo).toHaveBeenCalledTimes(2)
  })

  it('does not intercept undo, redo or find inside the find and comments fields', () => {
    const undo = vi.fn()
    const redo = vi.fn()
    const focusFind = vi.fn()
    const handlers = { save: vi.fn(), undo, redo, focusFind }

    for (const field of [
      document.createElement('input'),
      document.createElement('textarea'),
    ]) {
      vi.clearAllMocks()
      const undoEvent = event('z', { target: field })
      handleDocumentWorkspaceKeys(undoEvent, handlers)
      expect(undo).not.toHaveBeenCalled()
      expect(undoEvent.preventDefault).not.toHaveBeenCalled()

      const redoEvent = event('z', { target: field, shiftKey: true })
      handleDocumentWorkspaceKeys(redoEvent, handlers)
      expect(redo).not.toHaveBeenCalled()
      expect(redoEvent.preventDefault).not.toHaveBeenCalled()

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

  it('routes print from Ctrl/Cmd+P and from inside a document field', () => {
    const print = vi.fn()
    const fromPage = event('p')
    handleDocumentWorkspaceKeys(fromPage, { save: vi.fn(), print })
    expect(fromPage.preventDefault).toHaveBeenCalled()
    expect(print).toHaveBeenCalledTimes(1)

    // Ctrl+P inside the find or comments field is still a print request, not a
    // text-editing command, so it must not be treated as a foreign field.
    const fromField = event('p', {
      target: document.createElement('textarea'),
    })
    handleDocumentWorkspaceKeys(fromField, { save: vi.fn(), print })
    expect(print).toHaveBeenCalledTimes(2)
  })

  it('leaves Ctrl/Cmd+Shift+P and Alt+P to the platform', () => {
    const print = vi.fn()
    const shiftP = event('p', { shiftKey: true })
    handleDocumentWorkspaceKeys(shiftP, { save: vi.fn(), print })
    handleDocumentWorkspaceKeys(event('p', { altKey: true }), {
      save: vi.fn(),
      print,
    })
    expect(shiftP.preventDefault).not.toHaveBeenCalled()
    expect(print).not.toHaveBeenCalled()
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

  it('routes Ctrl/Cmd+B, I and U to the format toggles', () => {
    const toggleBold = vi.fn()
    const toggleItalic = vi.fn()
    const toggleUnderline = vi.fn()
    const handlers = {
      save: vi.fn(),
      toggleBold,
      toggleItalic,
      toggleUnderline,
    }

    for (const [key, handler] of [
      ['b', toggleBold],
      ['i', toggleItalic],
      ['u', toggleUnderline],
    ] as const) {
      const keyEvent = event(key)
      handleDocumentWorkspaceKeys(keyEvent, handlers)
      expect(keyEvent.preventDefault).toHaveBeenCalled()
      expect(handler).toHaveBeenCalledTimes(1)
    }
  })

  it('leaves B/I/U alone in foreign form fields and for Shift chords', () => {
    const toggleBold = vi.fn()
    const toggleItalic = vi.fn()
    const toggleUnderline = vi.fn()
    const handlers = {
      save: vi.fn(),
      toggleBold,
      toggleItalic,
      toggleUnderline,
    }

    for (const field of [
      document.createElement('input'),
      document.createElement('textarea'),
    ]) {
      for (const key of ['b', 'i', 'u']) {
        const keyEvent = event(key, { target: field })
        handleDocumentWorkspaceKeys(keyEvent, handlers)
        expect(keyEvent.preventDefault).not.toHaveBeenCalled()
      }
    }
    // Ctrl+Shift+B is a browser chord, not the document's Bold.
    const shiftB = event('b', { shiftKey: true })
    handleDocumentWorkspaceKeys(shiftB, handlers)
    expect(shiftB.preventDefault).not.toHaveBeenCalled()
    expect(toggleBold).not.toHaveBeenCalled()
    expect(toggleItalic).not.toHaveBeenCalled()
    expect(toggleUnderline).not.toHaveBeenCalled()
  })

  it('does not claim B/I/U when the matching toggle is unavailable', () => {
    const boldEvent = event('b')
    // The caller omits the handler for a tracked partial-range refusal, so the
    // keystroke falls through rather than being swallowed.
    handleDocumentWorkspaceKeys(boldEvent, { save: vi.fn() })
    expect(boldEvent.preventDefault).not.toHaveBeenCalled()
  })
})
