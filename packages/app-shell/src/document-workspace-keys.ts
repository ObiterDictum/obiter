export type WorkspaceKeyEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  preventDefault: () => void
  target?: EventTarget | null
}

function isForeignFormField(target: EventTarget | null | undefined) {
  if (!target || !(target instanceof Element)) return false
  const isField =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  if (!isField) return false
  return !target.closest('[data-paragraph-id]')
}

export function handleDocumentWorkspaceKeys(
  event: WorkspaceKeyEvent,
  handlers: {
    save: () => void
    undo?: () => void
    redo?: () => void
    focusFind?: () => void
    print?: () => void
  },
) {
  const key = event.key.toLowerCase()
  if (!(event.metaKey || event.ctrlKey)) return
  // AltGr reports as Ctrl+Alt on Windows, so any Alt-combined chord is a
  // character shortcut for the layout, never a document command. One guard
  // here covers save, undo, redo and find rather than each branch separately.
  if (event.altKey) return
  // The find box and the comments box are inputs inside the workspace
  // section. Do not swallow their native Ctrl+Z/Ctrl+F so field text can be
  // undone; only document save is still routed from those fields.
  const inForeignField = isForeignFormField(event.target)
  if (key === 's') {
    event.preventDefault()
    handlers.save()
    return
  }
  // Ctrl/Cmd+P is the platform print chord. Route it through the same handler
  // as the ribbon control so both print the painted document; Shift+P stays a
  // browser chord and is not claimed here.
  if (key === 'p' && !event.shiftKey && handlers.print) {
    event.preventDefault()
    handlers.print()
    return
  }
  if (!inForeignField && key === 'z' && handlers.undo && !event.shiftKey) {
    event.preventDefault()
    handlers.undo()
    return
  }
  // Ctrl/Cmd+Shift+Z is redo everywhere; Ctrl/Cmd+Y is the Windows and Linux
  // binding. As with save and find elsewhere here, either modifier routes the
  // same shortcut, so the platform decides the habit rather than a detection.
  if (
    !inForeignField &&
    handlers.redo &&
    ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey))
  ) {
    event.preventDefault()
    handlers.redo()
    return
  }
  if (!inForeignField && key === 'f' && handlers.focusFind) {
    event.preventDefault()
    handlers.focusFind()
  }
}
