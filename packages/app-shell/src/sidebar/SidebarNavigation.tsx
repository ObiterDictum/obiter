import {
  BeakerIcon as BeakerIconOutline,
  BellAlertIcon as BellAlertIconOutline,
  BuildingLibraryIcon as BuildingLibraryIconOutline,
  ChevronDownIcon as ChevronDownIconOutline,
  CircleStackIcon as CircleStackIconOutline,
  ClockIcon as ClockIconOutline,
  CodeBracketIcon as CodeBracketIconOutline,
  DocumentArrowUpIcon as DocumentArrowUpIconOutline,
  DocumentTextIcon as DocumentTextIconOutline,
  EyeSlashIcon as EyeSlashIconOutline,
  FolderIcon as FolderIconOutline,
  GlobeAltIcon as GlobeAltIconOutline,
  ShieldCheckIcon as ShieldCheckIconOutline,
  Squares2X2Icon as Squares2X2IconOutline,
} from '@heroicons/react/24/outline'
import {
  BeakerIcon as BeakerIconSolid,
  BellAlertIcon as BellAlertIconSolid,
  BuildingLibraryIcon as BuildingLibraryIconSolid,
  ChevronDownIcon as ChevronDownIconSolid,
  CircleStackIcon as CircleStackIconSolid,
  ClockIcon as ClockIconSolid,
  CodeBracketIcon as CodeBracketIconSolid,
  DocumentArrowUpIcon as DocumentArrowUpIconSolid,
  DocumentTextIcon as DocumentTextIconSolid,
  EyeSlashIcon as EyeSlashIconSolid,
  FolderIcon as FolderIconSolid,
  GlobeAltIcon as GlobeAltIconSolid,
  ShieldCheckIcon as ShieldCheckIconSolid,
  Squares2X2Icon as Squares2X2IconSolid,
} from '@heroicons/react/24/solid'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { SidebarNavItem } from './types'

const collapsedSectionsStorageKey = 'ormont.sidebar.collapsedSections'

const navSections: Array<{ label?: string, items: SidebarNavItem[] }> = [
  {
    items: [
      { icon: { outline: Squares2X2IconOutline, solid: Squares2X2IconSolid }, label: 'Home', status: 'live', to: '/workspace' },
      { icon: { outline: FolderIconOutline, solid: FolderIconSolid }, label: 'Matters', status: 'live', to: '/matters' },
      { icon: { outline: GlobeAltIconOutline, solid: GlobeAltIconSolid }, label: 'Search', status: 'live', to: '/search' },
      { icon: { outline: DocumentTextIconOutline, solid: DocumentTextIconSolid }, label: 'Drafting', status: 'planned' },
      { icon: { outline: BeakerIconOutline, solid: BeakerIconSolid }, label: 'Research', status: 'planned' },
    ],
  },
  {
    label: 'Evidence & Review',
    items: [
      { icon: { outline: CircleStackIconOutline, solid: CircleStackIconSolid }, label: 'Documents', status: 'planned' },
      { icon: { outline: EyeSlashIconOutline, solid: EyeSlashIconSolid }, label: 'Redaction', status: 'planned' },
      { icon: { outline: ShieldCheckIconOutline, solid: ShieldCheckIconSolid }, label: 'Verification', status: 'planned' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { icon: { outline: BellAlertIconOutline, solid: BellAlertIconSolid }, label: 'Review Queue', status: 'planned' },
      { icon: { outline: ClockIconOutline, solid: ClockIconSolid }, label: 'Deadlines', status: 'planned' },
      { icon: { outline: DocumentArrowUpIconOutline, solid: DocumentArrowUpIconSolid }, label: 'Uploads', status: 'planned' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { icon: { outline: BuildingLibraryIconOutline, solid: BuildingLibraryIconSolid }, label: 'Evaluation', status: 'planned' },
      { icon: { outline: CodeBracketIconOutline, solid: CodeBracketIconSolid }, label: 'Developer API', status: 'planned' },
    ],
  },
]

function SidebarNavigationItem({
  active,
  item,
}: {
  active: boolean
  item: SidebarNavItem
}) {
  const OutlineIcon = item.icon.outline
  const SolidIcon = item.icon.solid
  const className = active
    ? 'ormont-sidebar-nav__item ormont-sidebar-nav__item--active'
    : item.status === 'planned'
      ? 'ormont-sidebar-nav__item ormont-sidebar-nav__item--planned'
      : 'ormont-sidebar-nav__item'
  const children = (
    <>
      <span className="ormont-sidebar-nav__icon-wrap" aria-hidden="true">
        <OutlineIcon className="ormont-sidebar-nav__icon" />
        <SolidIcon className="ormont-sidebar-nav__icon ormont-sidebar-nav__icon--solid" />
      </span>
      <span>{item.label}</span>
      {item.status === 'planned' ? (
        <span className="ormont-sidebar-nav__status">Planned</span>
      ) : item.badgeTone ? (
        <span className="ormont-sidebar-nav__dot" data-tone={item.badgeTone} aria-hidden="true" />
      ) : null}
    </>
  )

  if (item.to) {
    return (
      <Link className={className} to={item.to}>
        {children}
      </Link>
    )
  }

  return (
    <button aria-disabled="true" className={className} type="button">
      {children}
    </button>
  )
}

export function SidebarNavigation({
  currentPath,
  showStaffNavigation = false,
}: {
  currentPath: string
  showStaffNavigation?: boolean
}) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    () => readCollapsedSections(),
  )

  function toggleSection(label: string) {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      writeCollapsedSections(next)
      return next
    })
  }

  return (
    <nav className="ormont-sidebar-nav" aria-label="Primary">
      {navSections.filter((section) => showStaffNavigation || section.label !== 'Advanced').map((section, sectionIndex) => (
        <div
          className={sectionIndex === 0 ? 'ormont-sidebar-nav__group' : 'ormont-sidebar-nav__group ormont-sidebar-nav__group--divided'}
          key={section.label ?? 'primary'}
        >
          {section.label ? (
            <button
              aria-expanded={!collapsedSections.has(section.label)}
              className="ormont-sidebar-section-toggle"
              type="button"
              onClick={() => toggleSection(section.label!)}
            >
              <span>{section.label}</span>
              <span className="ormont-sidebar-section-toggle__icon-wrap" aria-hidden="true">
                <ChevronDownIconOutline className="ormont-sidebar-section-toggle__icon" />
                <ChevronDownIconSolid className="ormont-sidebar-section-toggle__icon ormont-sidebar-section-toggle__icon--solid" />
              </span>
            </button>
          ) : null}
          <div className="ormont-sidebar-nav__items" hidden={section.label ? collapsedSections.has(section.label) : false}>
            {section.items.map((item) => (
              <SidebarNavigationItem
                active={
                  item.to === '/workspace'
                    ? currentPath === '/workspace'
                    : item.to === '/search'
                      ? currentPath === '/search' || currentPath.startsWith('/cases/')
                      : currentPath.startsWith(item.to ?? '\u0000')
                }
                item={item}
                key={item.label}
              />
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

export function readCollapsedSections() {
  if (typeof window === 'undefined') {
    return new Set<string>()
  }

  const raw = window.localStorage.getItem(collapsedSectionsStorageKey)
  if (!raw) {
    return new Set<string>()
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return new Set<string>()
    }

    const validLabels = new Set(
      navSections.flatMap((section) => section.label ? [section.label] : []),
    )

    return new Set(
      parsed.filter((label): label is string =>
        typeof label === 'string' && validLabels.has(label),
      ),
    )
  } catch {
    return new Set<string>()
  }
}

export function writeCollapsedSections(sections: Set<string>) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    collapsedSectionsStorageKey,
    JSON.stringify([...sections]),
  )
}
