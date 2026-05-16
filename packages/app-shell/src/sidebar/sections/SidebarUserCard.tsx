import { Menu } from '@base-ui-components/react/menu'
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
import { SidebarIconPair } from '../components/SidebarIconPair'
import type { SidebarIconSet } from '../types'

interface SidebarUserCardProps {
  organisationName: string
  onSignOut: () => void
  userName: string
}

interface SidebarUserMenuItemProps {
  icon: SidebarIconSet
  label: string
  onClick?: () => void
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

function SidebarUserMenuItem({ icon, label, onClick }: SidebarUserMenuItemProps) {
  return (
    <Menu.Item className="ormont-sidebar-user__menu-item" onClick={onClick}>
      <span className="ormont-sidebar-user__menu-icon-wrap" aria-hidden="true">
        <SidebarIconPair
          className="ormont-sidebar-user__menu-icon"
          icon={icon}
          solidClassName="ormont-sidebar-user__menu-icon--solid"
        />
      </span>
      <span>{label}</span>
    </Menu.Item>
  )
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
      <Menu.Root modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
        <div className={menuClassName} aria-hidden={!menuOpen}>
          <Menu.Popup className="ormont-sidebar-user__menu">
            <SidebarUserMenuItem
              icon={{ outline: Cog6ToothIconOutline, solid: Cog6ToothIconSolid }}
              label="Settings"
            />
            <SidebarUserMenuItem
              icon={{ outline: QuestionMarkCircleIconOutline, solid: QuestionMarkCircleIconSolid }}
              label="Help"
            />
            <SidebarUserMenuItem
              icon={{ outline: ArrowRightStartOnRectangleIconOutline, solid: ArrowRightStartOnRectangleIconSolid }}
              label="Sign out"
              onClick={onSignOut}
            />
          </Menu.Popup>
        </div>

        <Menu.Trigger className="ormont-sidebar-user__identity" type="button">
          <span className="ormont-sidebar-user__avatar">{getInitials(userName)}</span>
          <span className="ormont-sidebar-user__copy">
            <strong>{userName}</strong>
            <span>{organisationName}</span>
          </span>
        </Menu.Trigger>
      </Menu.Root>
    </section>
  )
}
