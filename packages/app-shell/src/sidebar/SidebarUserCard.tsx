import {
  ArrowRightStartOnRectangleIcon as ArrowRightStartOnRectangleIconOutline,
  Cog6ToothIcon as Cog6ToothIconOutline,
  QuestionMarkCircleIcon as QuestionMarkCircleIconOutline,
} from '@heroicons/react/24/outline'
import {
  ArrowRightStartOnRectangleIcon as ArrowRightStartOnRectangleIconSolid,
  Cog6ToothIcon as Cog6ToothIconSolid,
  QuestionMarkCircleIcon as QuestionMarkCircleIconSolid,
} from '@heroicons/react/24/solid'
import { useState } from 'react'

interface SidebarUserCardProps {
  organisationName: string
  onSignOut: () => void
  userName: string
}

function getInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .replace(/[^a-z]/gi, '')
    .slice(0, 2)
    .toUpperCase() || 'AM'
}

export function SidebarUserCard({
  organisationName,
  onSignOut,
  userName,
}: SidebarUserCardProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuClassName = menuOpen
    ? 'ormont-sidebar-user__menu-shell ormont-sidebar-user__menu-shell--open'
    : 'ormont-sidebar-user__menu-shell'

  return (
    <section className="ormont-sidebar-user" aria-label="Current user">
      <div className={menuClassName} aria-hidden={!menuOpen}>
        <div className="ormont-sidebar-user__menu" role="menu">
          <button
            className="ormont-sidebar-user__menu-item"
            type="button"
            tabIndex={menuOpen ? 0 : -1}
            role="menuitem"
          >
            <span className="ormont-sidebar-user__menu-icon-wrap" aria-hidden="true">
              <Cog6ToothIconOutline className="ormont-sidebar-user__menu-icon" />
              <Cog6ToothIconSolid className="ormont-sidebar-user__menu-icon ormont-sidebar-user__menu-icon--solid" />
            </span>
            <span>Settings</span>
          </button>
          <button
            className="ormont-sidebar-user__menu-item"
            type="button"
            tabIndex={menuOpen ? 0 : -1}
            role="menuitem"
          >
            <span className="ormont-sidebar-user__menu-icon-wrap" aria-hidden="true">
              <QuestionMarkCircleIconOutline className="ormont-sidebar-user__menu-icon" />
              <QuestionMarkCircleIconSolid className="ormont-sidebar-user__menu-icon ormont-sidebar-user__menu-icon--solid" />
            </span>
            <span>Help</span>
          </button>
          <button
            className="ormont-sidebar-user__menu-item"
            type="button"
            onClick={onSignOut}
            tabIndex={menuOpen ? 0 : -1}
            role="menuitem"
          >
            <span className="ormont-sidebar-user__menu-icon-wrap" aria-hidden="true">
              <ArrowRightStartOnRectangleIconOutline className="ormont-sidebar-user__menu-icon" />
              <ArrowRightStartOnRectangleIconSolid className="ormont-sidebar-user__menu-icon ormont-sidebar-user__menu-icon--solid" />
            </span>
            <span>Sign out</span>
          </button>
        </div>
      </div>

      <button
        aria-expanded={menuOpen}
        className="ormont-sidebar-user__identity"
        type="button"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="ormont-sidebar-user__avatar">{getInitials(userName)}</span>
        <span className="ormont-sidebar-user__copy">
          <strong>{userName}</strong>
          <span>{organisationName}</span>
        </span>
      </button>
    </section>
  )
}
