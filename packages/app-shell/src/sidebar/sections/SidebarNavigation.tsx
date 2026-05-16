import { Link } from '@tanstack/react-router'
import { SidebarDisclosure } from '../components/SidebarDisclosure'
import { SidebarIconPair } from '../components/SidebarIconPair'
import { navSections } from '../data/navigationItems'
import type { SidebarNavItem, SidebarNavSection } from '../types'

function SidebarNavigationItem({
  active,
  item,
}: {
  active: boolean
  item: SidebarNavItem
}) {
  const className = active
    ? 'ormont-sidebar-nav__item ormont-sidebar-nav__item--active'
    : 'ormont-sidebar-nav__item'
  const children = (
    <>
      <span className="ormont-sidebar-nav__icon-wrap" aria-hidden="true">
        <SidebarIconPair
          className="ormont-sidebar-nav__icon"
          icon={item.icon}
          solidClassName="ormont-sidebar-nav__icon--solid"
        />
      </span>
      <span>{item.label}</span>
      {item.badgeTone ? (
        <span className="ormont-sidebar-nav__dot" data-tone={item.badgeTone} aria-hidden="true" />
      ) : null}
    </>
  )

  if (item.to === '/workspace') {
    return (
      <Link className={className} to="/workspace">
        {children}
      </Link>
    )
  }

  if (item.to === '/matters') {
    return (
      <Link className={className} to="/matters">
        {children}
      </Link>
    )
  }

  return (
    <button className={className} type="button">
      {children}
    </button>
  )
}

function SidebarNavigationItems({ currentPath, section }: { currentPath: string, section: SidebarNavSection }) {
  return (
    <div className="ormont-sidebar-nav__items">
      {section.items.map((item) => (
        <SidebarNavigationItem
          active={item.to === '/workspace' ? currentPath === '/workspace' : currentPath.startsWith(item.to ?? '\u0000')}
          item={item}
          key={item.label}
        />
      ))}
    </div>
  )
}

export function SidebarNavigation({ currentPath }: { currentPath: string }) {
  return (
    <nav className="ormont-sidebar-nav" aria-label="Primary">
      {navSections.map((section, sectionIndex) => (
        <div
          className={sectionIndex === 0 ? 'ormont-sidebar-nav__group' : 'ormont-sidebar-nav__group ormont-sidebar-nav__group--divided'}
          key={section.label ?? 'primary'}
        >
          {section.label ? (
            <SidebarDisclosure panelClassName="ormont-sidebar-nav__items" title={section.label}>
              {section.items.map((item) => (
                <SidebarNavigationItem
                  active={item.to === '/workspace' ? currentPath === '/workspace' : currentPath.startsWith(item.to ?? '\u0000')}
                  item={item}
                  key={item.label}
                />
              ))}
            </SidebarDisclosure>
          ) : (
            <SidebarNavigationItems currentPath={currentPath} section={section} />
          )}
        </div>
      ))}
    </nav>
  )
}
