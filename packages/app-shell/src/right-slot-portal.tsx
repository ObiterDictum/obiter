import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

export type DocumentPanelTab = 'comments' | 'checks' | 'history'

type Targets = Record<DocumentPanelTab, HTMLElement | null>
type Register = (tab: DocumentPanelTab, node: HTMLElement | null) => void
type Show = (tab: DocumentPanelTab | null) => void

const NO_TARGETS = {
  comments: null,
  checks: null,
  history: null,
} satisfies Targets
const TargetsContext = createContext<Targets>(NO_TARGETS)
const RegisterContext = createContext<Register | null>(null)
const ShowContext = createContext<Show | null>(null)

export function RightSlotPortalProvider({
  children,
  onShow,
}: {
  children: ReactNode
  onShow?: Show
}) {
  const [targets, setTargets] = useState<Targets>(NO_TARGETS)
  const [register] = useState(() => {
    const update: Register = (tab, node) =>
      setTargets((current) =>
        current[tab] === node ? current : { ...current, [tab]: node },
      )
    return update
  })
  return (
    <RegisterContext.Provider value={register}>
      <ShowContext.Provider value={onShow ?? null}>
        <TargetsContext.Provider value={targets}>
          {children}
        </TargetsContext.Provider>
      </ShowContext.Provider>
    </RegisterContext.Provider>
  )
}

export function useRightSlotTarget(tab: DocumentPanelTab): HTMLElement | null {
  return useContext(TargetsContext)[tab]
}

export function useShownRightSlotTab(): DocumentPanelTab | null {
  const targets = useContext(TargetsContext)
  if (targets.comments) return 'comments'
  if (targets.checks) return 'checks'
  if (targets.history) return 'history'
  return null
}

export function useShowRightSlotTab(): Show | null {
  return useContext(ShowContext)
}

export function RightSlotPortal({
  tab,
  children,
}: {
  tab: DocumentPanelTab
  children: ReactNode
}) {
  const target = useRightSlotTarget(tab)
  return target ? createPortal(children, target) : null
}

export function RightSlotOutlet({ tab }: { tab: DocumentPanelTab }) {
  const register = useContext(RegisterContext)
  const ref = useCallback(
    (node: HTMLDivElement | null) => register?.(tab, node),
    [register, tab],
  )
  if (!register) {
    throw new Error(
      'RightSlotOutlet must render inside RightSlotPortalProvider',
    )
  }
  return (
    <div className="flex flex-col">
      <div ref={ref} data-right-slot-tab={tab} className="peer" />
      <p role="status" className="hidden text-body text-muted peer-empty:block">
        Opening the document…
      </p>
    </div>
  )
}
