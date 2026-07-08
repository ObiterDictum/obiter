import { useEffect, useRef, type KeyboardEvent } from 'react'

interface SearchKeyboardShortcutsProps {
  onClose: () => void
}

const shortcuts = [
  { keys: 'ArrowDown / j', action: 'Select next result' },
  { keys: 'ArrowUp / k', action: 'Select previous result' },
  { keys: 'Enter', action: 'Open selected result or run search' },
  { keys: '?', action: 'Show shortcuts' },
  { keys: 'Escape', action: 'Close shortcuts' },
]

export function SearchKeyboardShortcuts({ onClose }: SearchKeyboardShortcutsProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return

    const focusableElements = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (!focusableElements || focusableElements.length === 0) {
      event.preventDefault()
      return
    }

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault()
      lastElement.focus()
      return
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault()
      firstElement.focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="search-shortcuts-title"
    >
      <div
        className="grid w-full max-w-[420px] gap-4 rounded-lg border border-line-strong bg-raised p-5 shadow-lg"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-ink" id="search-shortcuts-title">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-canvas"
          >
            Close
          </button>
        </div>
        <dl className="flex flex-col gap-2">
          {shortcuts.map((shortcut) => (
            <div className="flex items-center justify-between gap-3" key={shortcut.keys}>
              <dt className="rounded-md border border-line bg-canvas px-2 py-1.5 text-sm text-ink">
                {shortcut.keys}
              </dt>
              <dd className="text-right text-sm text-muted">{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
