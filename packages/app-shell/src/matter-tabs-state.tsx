import { useNavigate, useRouterState } from '@tanstack/react-router'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  closeTab,
  emptyMatterTabState,
  includeRouteTab,
  matterTabFromPath,
  matterTabPath,
  matterTabStorageKey,
  neighbourTabId,
  openTab,
  overviewTab,
  promoteTab,
  writeMatterTabs,
  type MatterTab,
  type MatterTabState,
} from './matter-tabs'
import { readStoredMatterTabs } from './matter-tab-storage'

export interface MatterTabsValue {
  matterId: string
  storageKey: string
  hydrate: (state: MatterTabState) => void
  tabs: MatterTab[]
  activeId: string | null
  sideId: string | null
  openPreview: (tab: MatterTab) => void
  openPermanent: (tab: MatterTab) => void
  goToTab: (tab: MatterTab) => void
  close: (id: string) => void
  reopenLastClosed: () => void
  promoteActive: () => void
  promote: (id: string) => void
  openToSide: (id: string) => void
  closeSide: () => void
}

const MatterTabsContext = createContext<MatterTabsValue | null>(null)

export function useMatterTabs(): MatterTabsValue {
  const value = useContext(MatterTabsContext)
  if (!value) throw new Error('Matter tabs need a matter.')
  return value
}

export function useMatterTabsOptional(): MatterTabsValue | null {
  return useContext(MatterTabsContext)
}

function readStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function useHydrateMatterTabs(): void {
  const { hydrate, storageKey } = useMatterTabs()
  useEffect(() => {
    hydrate(readStoredMatterTabs(storageKey))
  }, [])
}

function sideFromSearch(search: string): string | null {
  return new URLSearchParams(search).get('side')
}

function withSide(path: string, side: string | null, search: string): string {
  const params = new URLSearchParams(search)
  if (side) params.set('side', side)
  else params.delete('side')
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

export function MatterTabsProvider({
  userId,
  matterId,
  children,
}: {
  userId: string
  matterId: string
  children: ReactNode
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const search = useRouterState({ select: (state) => state.location.searchStr })
  const navigate = useNavigate()
  const key = matterTabStorageKey(userId, matterId)
  const [state, setState] = useState<MatterTabState>(emptyMatterTabState)
  const [hydrated, setHydrated] = useState(false)

  const routeTab = matterTabFromPath(pathname)
  const activeId = routeTab?.id ?? null
  const sideId = sideFromSearch(search)
  const tabs = includeRouteTab(state.tabs, routeTab)

  function hydrate(next: MatterTabState) {
    setState((current) => (current.tabs.length > 0 ? current : next))
    setHydrated(true)
  }

  function commit(next: MatterTabState) {
    setState(next)
    writeMatterTabs(readStorage(), key, next)
  }

  function go(path: string, side: string | null) {
    void navigate({ href: withSide(path, side, search) })
  }

  function goToTab(tab: MatterTab) {
    go(matterTabPath(matterId, tab), sideId)
  }

  function openPreview(tab: MatterTab) {
    commit({
      tabs: openTab(tabs, tab, { preview: true }),
      lastClosed: state.lastClosed,
    })
  }

  function openPermanent(tab: MatterTab) {
    commit({ tabs: openTab(tabs, tab), lastClosed: state.lastClosed })
  }

  function close(id: string) {
    const next = closeTab({ tabs, lastClosed: state.lastClosed }, id)
    if (next === state) return
    commit(next)
    if (id === sideId) {
      go(
        id === activeId ? matterTabPath(matterId, overviewTab()) : pathname,
        null,
      )
      return
    }
    if (id !== activeId) return
    if (sideId) {
      const side = tabs.find((tab) => tab.id === sideId)
      go(side ? matterTabPath(matterId, side) : pathname, null)
      return
    }
    const neighbour = neighbourTabId(tabs, id)
    const target = tabs.find((tab) => tab.id === neighbour)
    go(matterTabPath(matterId, target ?? overviewTab()), null)
  }

  function reopen() {
    const reopened = state.lastClosed
    if (!reopened) return
    commit({ tabs: openTab(tabs, reopened), lastClosed: null })
    go(matterTabPath(matterId, reopened), sideId)
  }

  function promote(id: string) {
    commit({ tabs: promoteTab(tabs, id), lastClosed: state.lastClosed })
  }

  function promoteActive() {
    if (activeId) promote(activeId)
  }

  useEffect(() => {
    if (!hydrated) return
    if (
      tabs.length === state.tabs.length &&
      tabs.every((tab, index) => tab.id === state.tabs[index]?.id)
    )
      return
    const next = { tabs, lastClosed: state.lastClosed }
    setState(next)
    writeMatterTabs(readStorage(), key, next)
  }, [pathname, hydrated])

  const value: MatterTabsValue = {
    matterId,
    storageKey: key,
    hydrate,
    tabs,
    activeId,
    sideId,
    openPreview,
    openPermanent,
    goToTab,
    close,
    reopenLastClosed: reopen,
    promoteActive,
    promote,
    openToSide: (id) => go(pathname, id),
    closeSide: () => go(pathname, null),
  }

  return (
    <MatterTabsContext.Provider value={value}>
      {children}
    </MatterTabsContext.Provider>
  )
}
