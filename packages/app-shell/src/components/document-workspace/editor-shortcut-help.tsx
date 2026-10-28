import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  KeyboardHint,
} from '@obiter/ui'

const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string }> = [
  { keys: ['Ctrl', 'S'], action: 'Save the document' },
  { keys: ['Ctrl', 'Z'], action: 'Undo' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo' },
  { keys: ['Ctrl', 'K'], action: 'All commands, by name' },
  { keys: ['Ctrl', 'F'], action: 'Find and replace' },
  { keys: ['Ctrl', 'P'], action: 'Print' },
  { keys: ['Ctrl', 'B'], action: 'Bold' },
  { keys: ['Ctrl', 'I'], action: 'Italic' },
  { keys: ['Ctrl', 'U'], action: 'Underline' },
  { keys: ['A'], action: 'Accept the current change and move on' },
  { keys: ['R'], action: 'Reject the current change and move on' },
  { keys: ['J', '↓'], action: 'Next change' },
  { keys: ['K', '↑'], action: 'Previous change' },
]

/**
 * The editor's shortcut help. Review letters only fire outside a field or the
 * document text, and the list says so where it would otherwise be surprising:
 * a reviewer who types "a" into a comment box must get an "a".
 */
export function EditorShortcutHelp({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogTitle className="text-item text-ink">
          Keyboard shortcuts
        </DialogTitle>
        <DialogDescription className="mt-1 text-caption text-subtle">
          Review letters work while the review panel is open and the focus is
          not in the document or a field.
        </DialogDescription>
        <dl className="mt-4 flex flex-col gap-2">
          {SHORTCUTS.map((shortcut) => (
            <div
              key={`${shortcut.keys.join('+')}-${shortcut.action}`}
              className="flex items-center justify-between gap-4"
            >
              <dt className="flex items-center gap-1">
                {shortcut.keys.map((key) => (
                  <KeyboardHint key={key}>{key}</KeyboardHint>
                ))}
              </dt>
              <dd className="text-right text-caption text-muted">
                {shortcut.action}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
