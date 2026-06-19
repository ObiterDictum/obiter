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
  return (
    <div className="legal-search-shortcuts" role="dialog" aria-modal="true" aria-labelledby="search-shortcuts-title">
      <div className="legal-search-shortcuts__panel">
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
