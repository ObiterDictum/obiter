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
    <div className="legal-search-shortcuts" role="dialog" aria-modal="true" aria-labelledby="search-shortcuts-title">
      <div
        className="legal-search-shortcuts__panel"
        onKeyDown={handleKeyDown}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="legal-search-shortcuts__header">
          <h2 id="search-shortcuts-title">Keyboard Shortcuts</h2>
          <button type="button" onClick={onClose} aria-label="Close keyboard shortcuts">
            Close
          </button>
        </div>
        <dl>
          {shortcuts.map((shortcut) => (
            <div key={shortcut.keys}>
              <dt>{shortcut.keys}</dt>
              <dd>{shortcut.action}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
