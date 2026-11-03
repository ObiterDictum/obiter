import { Link } from '@tanstack/react-router'
import {
  Popover,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTrigger,
  cn,
} from '@obiter/ui'
import { CaretRight } from '@obiter/ui/icons/shell'
import { useState } from 'react'
import { paletteScore } from './command-palette-rows'
import { useMattersList, type MatterRecord } from './matters'
import { recentMatters } from './sidebar-counts'

const SWITCHER_LIMIT = 8

export function matterChoices(
  matters: MatterRecord[],
  filter: string,
  currentMatterId: string,
): MatterRecord[] {
  const trimmed = filter.trim()
  if (!trimmed) return recentMatters(matters, SWITCHER_LIMIT)
  return [...matters]
    .filter((matter) => matter.id !== currentMatterId)
    .filter(
      (matter) =>
        paletteScore(
          matter.name,
          matter.clientReference ?? undefined,
          trimmed,
        ) !== null,
    )
    .slice(0, SWITCHER_LIMIT)
}

export function MatterSwitcher({
  matterId,
  matterName,
}: {
  matterId: string
  matterName: string
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const matters = useMattersList().data ?? []
  const choices = matterChoices(matters, filter, matterId)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setFilter('')
      }}
    >
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Switch matter, current matter ${matterName}`}
            className="flex min-w-0 max-w-[24rem] items-center gap-1.5 rounded-md px-1 py-0.5 text-ink transition-colors duration-150 hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        }
      >
        <span className="min-w-0 truncate">{matterName}</span>
        <CaretRight
          size={12}
          aria-hidden
          className="shrink-0 rotate-90 text-subtle"
        />
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverPositioner sideOffset={6} align="start">
          <PopoverPopup className="w-72 p-0" aria-label="Switch matter">
            <div className="border-b border-line p-2">
              <input
                autoFocus
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                aria-label="Filter matters"
                placeholder="Filter matters"
                className="h-8 w-full rounded-md border border-line bg-surface px-2 text-meta text-ink outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            <ul className="max-h-72 overflow-y-auto p-1.5">
              {choices.length === 0 ? (
                <li className="px-2 py-2 text-caption text-subtle">
                  No matters match “{filter.trim()}”.
                </li>
              ) : (
                choices.map((matter) => (
                  <li key={matter.id}>
                    <Link
                      to="/matters/$matterId"
                      params={{ matterId: matter.id }}
                      onClick={() => setOpen(false)}
                      className={cn(
                        'flex min-h-9 items-center gap-2 rounded-md px-2 py-1.5 text-left text-meta',
                        matter.id === matterId
                          ? 'text-ink'
                          : 'text-muted hover:bg-hover hover:text-ink',
                      )}
                    >
                      <span className="grid size-4 shrink-0 place-items-center">
                        {matter.id === matterId ? (
                          <span
                            aria-hidden
                            className="size-1.5 rounded-pill bg-brand"
                          />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{matter.name}</span>
                        {matter.clientReference ? (
                          <span className="block truncate font-mono text-caption text-subtle">
                            {matter.clientReference}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))
              )}
            </ul>
            <div className="border-t border-line p-1.5">
              <Link
                to="/matters"
                onClick={() => setOpen(false)}
                className="flex min-h-8 items-center rounded-md px-2 text-meta text-muted hover:bg-hover hover:text-ink"
              >
                All matters
              </Link>
            </div>
          </PopoverPopup>
        </PopoverPositioner>
      </PopoverPortal>
    </Popover>
  )
}
