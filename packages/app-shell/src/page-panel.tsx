import { createContext, useContext, type ReactNode, type Ref } from 'react'

export interface PagePanel {
  name: string
  expanded: boolean
  overlay: boolean
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
}: {
  site?: 'page' | 'panel'
}) {
  const panel = useContext(PagePanelContext)
  if (!panel) return null
  const here = panel.overlay
    ? panel.expanded === (site === 'panel')
    : site === 'page'
  if (!here) return null
  return (
    <button
      type="button"
      ref={panel.buttonRef}
      aria-controls={panel.controls}
      aria-expanded={panel.expanded}
      onClick={panel.toggle}
      className="inline-flex h-8 shrink-0 items-center rounded-md px-2 text-meta text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {panel.expanded ? 'Hide' : 'Show'} {panel.name}
    </button>
  )
}
