import type { ShellSnapshot } from '@ormont/contracts'
import {
  ChevronDoubleLeftIcon as ChevronDoubleLeftIconOutline,
  ChevronDoubleRightIcon as ChevronDoubleRightIconOutline,
} from '@heroicons/react/24/outline'
import {
  ChevronDoubleLeftIcon as ChevronDoubleLeftIconSolid,
  ChevronDoubleRightIcon as ChevronDoubleRightIconSolid,
} from '@heroicons/react/24/solid'
import { useState } from 'react'
import { SidebarMatterPanel } from './SidebarMatterPanel'
import { SidebarNavigation } from './SidebarNavigation'
import { SidebarRecentResearch } from './SidebarRecentResearch'
import { SidebarSearch } from './SidebarSearch'
import { SidebarUserCard } from './SidebarUserCard'
import { SidebarWorkspaceCard } from './SidebarWorkspaceCard'

interface OrmontSidebarProps {
  currentPath: string
  onSignOut: () => void
  snapshot: ShellSnapshot
}

export function OrmontSidebar({ currentPath, onSignOut, snapshot }: OrmontSidebarProps) {
  const [contentCollapsed, setContentCollapsed] = useState(false)
  const [contentClosing, setContentClosing] = useState(false)
  const [contentOpening, setContentOpening] = useState(false)
  const sidebarClassName = [
    'ormont-app-sidebar',
    contentCollapsed ? 'ormont-app-sidebar--content-collapsed' : null,
    contentClosing ? 'ormont-app-sidebar--content-closing' : null,
    contentOpening ? 'ormont-app-sidebar--content-opening' : null,
  ].filter(Boolean).join(' ')

  function collapseContent() {
    setContentOpening(false)
    setContentClosing(true)
    window.setTimeout(() => {
      setContentCollapsed(true)
      setContentClosing(false)
    }, 160)
  }

  function expandContent() {
    setContentClosing(false)
    setContentCollapsed(false)
    setContentOpening(true)
    window.setTimeout(() => setContentOpening(false), 470)
  }

  return (
    <aside className={sidebarClassName} aria-label="Ormont application sidebar">
      <button
        aria-label="Expand sidebar"
        aria-pressed={contentCollapsed}
        className="ormont-app-sidebar__content-expand"
        type="button"
        onClick={expandContent}
      >
        <ChevronDoubleRightIconOutline aria-hidden="true" className="ormont-sidebar-rail__icon" />
        <ChevronDoubleRightIconSolid aria-hidden="true" className="ormont-sidebar-rail__icon ormont-sidebar-rail__icon--solid" />
      </button>

      <div className="ormont-app-sidebar__panel">
        <button
          aria-label="Collapse sidebar"
          className="ormont-app-sidebar__content-collapse"
          type="button"
          onClick={collapseContent}
        >
          <ChevronDoubleLeftIconOutline aria-hidden="true" className="ormont-sidebar-rail__icon" />
          <ChevronDoubleLeftIconSolid aria-hidden="true" className="ormont-sidebar-rail__icon ormont-sidebar-rail__icon--solid" />
        </button>

        <div className="ormont-app-sidebar__main">
          <h1 className="ormont-app-sidebar__title">Ormont</h1>
          <SidebarSearch />
          <SidebarWorkspaceCard mode={currentPath === '/workspace' ? 'last-active' : 'active'} />
          <SidebarNavigation
            currentPath={currentPath}
            showStaffNavigation={
              snapshot.organisation.id === 'org-ormont-demo' &&
              snapshot.currentUser.role === 'owner'
            }
          />
        </div>

        <div className="ormont-app-sidebar__bottom">
          <div className="ormont-sidebar-quick-access">
            <SidebarMatterPanel />
            <SidebarRecentResearch />
          </div>

          <SidebarUserCard
            organisationName={snapshot.organisation.name}
            onSignOut={onSignOut}
            userName={snapshot.currentUser.name}
          />
        </div>
      </div>
    </aside>
  )
}
