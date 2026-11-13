import { Tooltip, TooltipContent, TooltipTrigger, cn } from '@obiter/ui'
import { SidebarSimple } from '@obiter/ui/icons'
import { createContext, useContext, type ReactNode, type Ref } from 'react'
import { ShortcutHint } from './shell-shortcuts'

export interface PagePanel {
  name: string
  expanded: boolean
  controls: string
  toggle: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

const PagePanelContext = createContext<PagePanel | null>(null)

export function PagePanelProvider({
  panel,
  children,
}: {
  panel: PagePanel | null
  children: ReactNode
}) {
  return (
    <PagePanelContext.Provider value={panel}>
      {children}
    </PagePanelContext.Provider>
  )
}

export function PagePanelToggle({
  site = 'page',
  className,
}: {
  site?: 'page' | 'panel'
  className?: string
}) {
  const panel = useContext(PagePanelContext)
  if (!panel) return null
  if ((site === 'panel') !== panel.expanded) return null
  const label = panel.expanded ? `Hide ${panel.name}` : `Show ${panel.name}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            ref={panel.buttonRef}
            aria-label={label}
            aria-controls={panel.controls}
            aria-expanded={panel.expanded}
            onClick={panel.toggle}
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              className,
            )}
          >
            <SidebarSimple size={16} aria-hidden />
          </button>
        }
      />
      <TooltipContent side="bottom">
        <span className="flex items-center gap-2">
          {label}
          <ShortcutHint command="toggle-nav" />
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
