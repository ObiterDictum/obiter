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
    save?: () => void
    undo?: () => void
    redo?: () => void
    focusFind?: () => void
    openPalette?: () => void
    print?: () => void
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
  if (event.altKey) return
  const claim = event.preventDefault.bind(event)
  const run = (handler: (() => void) | undefined) => {
    if (!handler) return false
    claim()
    handler()
    return true
  }
  if (key === 's' && run(handlers.save)) return
  if (key === 'p' && !event.shiftKey && run(handlers.print)) return
  if (isForeignFormField(event.target)) return
  if (key === 'z' && !event.shiftKey && run(handlers.undo)) return
  if (
    ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) &&
    run(handlers.redo)
  ) {
    return
  }
  if (key === 'f' && run(handlers.focusFind)) return
  if (key === 'k' && !event.shiftKey && run(handlers.openPalette)) return
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

const focusDocumentFind = () =>
  document.getElementById('document-find')?.focus()

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
    focusFind: openFind ?? focusDocumentFind,
    openPalette,
    toggleBold: emphasis?.onToggleBold,
    toggleItalic: emphasis?.onToggleItalic,
    toggleUnderline: emphasis?.onToggleUnderline,
  })
}
