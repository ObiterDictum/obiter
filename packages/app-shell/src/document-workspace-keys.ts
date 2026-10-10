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
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement)
  ) {
    return false
  }
  return !target.closest('[data-paragraph-id]')
}

export function handleDocumentWorkspaceKeys(
  event: WorkspaceKeyEvent,
  handlers: {
    /** Absent on a surface with no save — the platform's own Ctrl/Cmd+S
     * stays unclaimed there. */
    save?: () => void
    undo?: () => void
    redo?: () => void
    focusFind?: () => void
    print?: () => void
    toggleBold?: () => void
    toggleItalic?: () => void
    toggleUnderline?: () => void
  },
) {
  const key = event.key.toLowerCase()
  if (!(event.metaKey || event.ctrlKey)) return
  // AltGr reports as Ctrl+Alt on Windows, so any Alt-combined chord is a
  // character shortcut for the layout, never a document command. One guard
  // here covers save, undo, redo, find and the character toggles.
  if (event.altKey) return
  // Every recognised chord claims the event the same way: preventDefault
  // keeps the platform's own handling out from under the workspace's. The
  // method needs its receiver, so the alias binds rather than detaches.
  const claim = event.preventDefault.bind(event)
  const run = (handler: (() => void) | undefined) => {
    if (!handler) return false
    claim()
    handler()
    return true
  }
  if (key === 's' && run(handlers.save)) return
  // Ctrl/Cmd+P is the platform print chord. Route it through the same handler
  // as the ribbon control so both print the painted document; Shift+P stays a
  // browser chord and is not claimed here.
  if (key === 'p' && !event.shiftKey && run(handlers.print)) return
  // The find box and the comments box are inputs inside the workspace
  // section. Do not swallow their native Ctrl+Z/Ctrl+F so field text can be
  // undone; only document save is still routed from those fields.
  if (isForeignFormField(event.target)) return
  if (key === 'z' && !event.shiftKey && run(handlers.undo)) return
  // Ctrl/Cmd+Shift+Z is redo everywhere; Ctrl/Cmd+Y is the Windows and Linux
  // binding. As with save and find elsewhere here, either modifier routes the
  // same shortcut, so the platform decides the habit rather than a detection.
  if (
    ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) &&
    run(handlers.redo)
  ) {
    return
  }
  if (key === 'f' && run(handlers.focusFind)) return
  // Ctrl/Cmd+B/I/U mirror the ribbon character controls. The caller wires these
  // only while the matching control is available, so a tracked partial range
  // that refuses the ribbon button also refuses the shortcut rather than
  // swallowing a keystroke the platform could not have used.
  if (!event.shiftKey) {
    run(
      key === 'b'
        ? handlers.toggleBold
        : key === 'i'
          ? handlers.toggleItalic
          : key === 'u'
            ? handlers.toggleUnderline
            : undefined,
    )
  }
}

export type WorkspaceKeySources = {
  /** Absent on a surface with no save — the platform's own Ctrl/Cmd+S
   * stays unclaimed there. */
  save?: () => void
  undo?: () => void
  redo?: () => void
  print?: () => void
  format?: {
    emphasisUnavailable?: string
    onToggleBold: () => void
    onToggleItalic: () => void
    onToggleUnderline: () => void
  }
}

const focusDocumentFind = () =>
  document.getElementById('document-find')?.focus()

/** Binds the workspace's command sources to the key handler table. */
export function documentWorkspaceKeyDown(
  event: WorkspaceKeyEvent,
  { save, undo, redo, print, format }: WorkspaceKeySources = {},
) {
  const emphasis = format && !format.emphasisUnavailable ? format : undefined
  handleDocumentWorkspaceKeys(event, {
    save,
    undo,
    redo,
    print,
    focusFind: focusDocumentFind,
    toggleBold: emphasis?.onToggleBold,
    toggleItalic: emphasis?.onToggleItalic,
    toggleUnderline: emphasis?.onToggleUnderline,
  })
}
