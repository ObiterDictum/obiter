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

/**
 * Whether a keystroke is going into text somewhere: the document's own fields,
 * a comment box, a search input. Review letters must not fire there — an "a"
 * typed into a comment is an "a".
 */
function isTyping(target: EventTarget | null | undefined) {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('[data-paragraph-id]')) return true
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true
  }
  return target.isContentEditable
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
    openPalette?: () => void
    print?: () => void
    /** Review navigation and decisions while the review panel is open. */
    review?: {
      onAccept: () => void
      onReject: () => void
      onNext: () => void
      onPrevious: () => void
    }
    toggleBold?: () => void
    toggleItalic?: () => void
    toggleUnderline?: () => void
  },
) {
  const key = event.key.toLowerCase()
  // Review letters are bare keys, so they are read before the modifier guard
  // and only when the focus is not already text.
  if (
    handlers.review &&
    !(event.metaKey || event.ctrlKey || event.altKey) &&
    !isTyping(event.target)
  ) {
    const act = (run: () => void) => {
      event.preventDefault()
      run()
    }
    if (key === 'a') return act(handlers.review.onAccept)
    if (key === 'r') return act(handlers.review.onReject)
    if (key === 'j' || key === 'arrowdown') return act(handlers.review.onNext)
    if (key === 'k' || key === 'arrowup') return act(handlers.review.onPrevious)
  }
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
  if (key === 'k' && !event.shiftKey && run(handlers.openPalette)) return
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
  openFind?: () => void
  openPalette?: () => void
  openFormatting?: () => void
  review?: {
    onAccept: () => void
    onReject: () => void
    onNext: () => void
    onPrevious: () => void
  }
  format?: {
    emphasisUnavailable?: string
    onToggleBold: () => void
    onToggleItalic: () => void
    onToggleUnderline: () => void
  }
}

/** Binds the workspace's command sources to the key handler table. */
export function documentWorkspaceKeyDown(
  event: WorkspaceKeyEvent,
  {
    save,
    undo,
    redo,
    print,
    openFind,
    openPalette,
    review,
    format,
  }: WorkspaceKeySources = {},
) {
  const emphasis = format && !format.emphasisUnavailable ? format : undefined
  handleDocumentWorkspaceKeys(event, {
    save,
    undo,
    redo,
    print,
    review,
    focusFind: openFind,
    openPalette,
    toggleBold: emphasis?.onToggleBold,
    toggleItalic: emphasis?.onToggleItalic,
    toggleUnderline: emphasis?.onToggleUnderline,
  })
}
