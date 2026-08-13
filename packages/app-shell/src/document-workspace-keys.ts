export type WorkspaceKeyEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  preventDefault: () => void
}

export function handleDocumentWorkspaceKeys(
  event: WorkspaceKeyEvent,
  handlers: {
    save: () => void
    undo?: () => void
    focusFind?: () => void
  },
) {
  const key = event.key.toLowerCase()
  if (!(event.metaKey || event.ctrlKey)) return
  if (key === 's') {
    event.preventDefault()
    handlers.save()
    return
  }
  if (key === 'z' && handlers.undo && !event.shiftKey) {
    event.preventDefault()
    handlers.undo()
    return
  }
  if (key === 'f' && handlers.focusFind) {
    event.preventDefault()
    handlers.focusFind()
  }
}
