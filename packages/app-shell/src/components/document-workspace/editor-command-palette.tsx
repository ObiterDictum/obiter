import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  cn,
} from '@obiter/ui'
import type { EditorCommand, EditorMenu } from './editor-commands'
import { editorCommandList } from './editor-commands'

type Hit = { menu: EditorMenu; group: string; command: EditorCommand }

/**
 * The command palette: every editor command by name, reachable from the
 * keyboard without learning where it lives. It searches the same command list
 * the menus are built from, so a command added to a menu is searchable here in
 * the same change — there is no second inventory to keep in step.
 */
export function EditorCommandPalette({
  open,
  onOpenChange,
  menus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  menus: readonly EditorMenu[]
}) {
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const all = editorCommandList(menus).map((hit) => ({
    ...hit,
    group: hit.group.label,
  }))
  const needle = query.trim().toLowerCase()
  const hits = needle
    ? all.filter(
        (hit) =>
          hit.command.label.toLowerCase().includes(needle) ||
          hit.group.toLowerCase().includes(needle) ||
          hit.menu.label.toLowerCase().includes(needle),
      )
    : all
  const current = Math.min(highlighted, Math.max(0, hits.length - 1))

  function run(hit: Hit) {
    onOpenChange(false)
    if (hit.command.disabled || hit.command.soon) return
    hit.command.run?.()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setQuery('')
          setHighlighted(0)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent size="md" className="p-0">
        <div className="flex flex-col">
          <div className="border-b border-line p-4">
            <DialogTitle className="text-item text-ink">
              Editor commands
            </DialogTitle>
            <DialogDescription className="text-caption text-subtle">
              Every document command by name. Arrow keys choose, Enter runs.
            </DialogDescription>
            <Input
              autoFocus
              aria-label="Search commands"
              placeholder="Search commands"
              value={query}
              className="mt-3"
              onChange={(event) => {
                setQuery(event.target.value)
                setHighlighted(0)
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setHighlighted((index) => Math.min(index + 1, hits.length - 1))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setHighlighted((index) => Math.max(index - 1, 0))
                  return
                }
                if (event.key !== 'Enter') return
                event.preventDefault()
                const hit = hits[current]
                if (hit) run(hit)
              }}
            />
          </div>
          <ul
            className="max-h-80 overflow-y-auto p-2"
            aria-label="Commands"
          >
            {hits.length === 0 ? (
              <li className="px-3 py-2 text-caption text-muted">
                No command matches “{query.trim()}”.
              </li>
            ) : (
              hits.map((hit, index) => (
                <li key={`${hit.menu.id}-${hit.command.id}`}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-item text-muted',
                      index === current && 'bg-hover text-ink',
                      hit.command.disabled ||
                        (hit.command.soon && 'opacity-45'),
                    )}
                    aria-current={index === current ? 'true' : undefined}
                    aria-disabled={hit.command.disabled || undefined}
                    disabled={hit.command.disabled || Boolean(hit.command.soon)}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => run(hit)}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {hit.command.label}
                    </span>
                    <span className="shrink-0 text-caption text-subtle">
                      {hit.menu.label} · {hit.group}
                    </span>
                    {hit.command.shortcut ? (
                      <span className="shrink-0 font-mono text-caption text-subtle">
                        {hit.command.shortcut}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  )
}
