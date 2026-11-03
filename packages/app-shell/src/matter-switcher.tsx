import { useNavigate } from '@tanstack/react-router'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
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
  const navigate = useNavigate()
  const [filter, setFilter] = useState('')
  const matters = useMattersList().data ?? []
  const choices = matterChoices(matters, filter, matterId)

  return (
    <Menu
      onOpenChange={(open) => {
        if (!open) setFilter('')
      }}
    >
      <MenuTrigger
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
      </MenuTrigger>
      <MenuContent aria-label="Switch matter" align="start">
        <div role="presentation" className="px-1 pb-1">
          <input
            autoFocus
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            aria-label="Filter matters"
            placeholder="Filter matters"
            className="h-8 w-full rounded-md border border-line bg-surface px-2 text-meta text-ink outline-none placeholder:text-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>
        {choices.length === 0 ? (
          <p role="presentation" className="px-3 py-2 text-caption text-subtle">
            No matters match “{filter.trim()}”.
          </p>
        ) : (
          choices.map((matter) => (
            <MenuItem
              key={matter.id}
              onClick={() =>
                void navigate({
                  to: '/matters/$matterId',
                  params: { matterId: matter.id },
                })
              }
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
                  <span
                    className={cn(
                      'block truncate font-mono text-caption text-subtle',
                    )}
                  >
                    {matter.clientReference}
                  </span>
                ) : null}
              </span>
            </MenuItem>
          ))
        )}
        <MenuSeparator />
        <MenuItem onClick={() => void navigate({ to: '/matters' })}>
          All matters
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
