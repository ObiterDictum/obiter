import { createContext, useContext } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@obiter/ui'
import { SidebarSimple } from '@obiter/ui/icons/shell'
import { ShortcutHint } from './shell-shortcuts'
export const AgentPanelContext = createContext<{
  open: boolean
  toggle: () => void
} | null>(null)
export function AgentPanelToggle() {
  const panel = useContext(AgentPanelContext)
  if (!panel) return null
  const label = panel.open ? 'Hide agent panel' : 'Show agent panel'
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-expanded={panel.open}
            aria-controls="app-shell-right-slot"
            onClick={panel.toggle}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-ring"
          >
            <SidebarSimple size={16} aria-hidden className="rotate-180" />
          </button>
        }
      />
      <TooltipContent>
        <span className="flex items-center gap-2">
          {label}
          <ShortcutHint command="toggle-right-slot" />
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
