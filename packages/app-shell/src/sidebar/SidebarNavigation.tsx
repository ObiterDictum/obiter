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

const navSections: Array<{ label?: string, items: SidebarNavItem[] }> = [
  {
    items: [
      { icon: { outline: Squares2X2IconOutline, solid: Squares2X2IconSolid }, label: 'Dashboard', to: '/workspace' },
      { icon: { outline: DocumentTextIconOutline, solid: DocumentTextIconSolid }, label: 'Draft' },
      { badgeTone: 'blue', icon: { outline: BeakerIconOutline, solid: BeakerIconSolid }, label: 'Research' },
      { icon: { outline: FolderIconOutline, solid: FolderIconSolid }, label: 'Matters', to: '/matters' },
    ],
  },
  {
    label: 'Evidence & Review',
    items: [
      { icon: { outline: CircleStackIconOutline, solid: CircleStackIconSolid }, label: 'Documents' },
      { icon: { outline: GlobeAltIconOutline, solid: GlobeAltIconSolid }, label: 'Authorities' },
      { badgeTone: 'purple', icon: { outline: EyeSlashIconOutline, solid: EyeSlashIconSolid }, label: 'Redact' },
      { badgeTone: 'amber', icon: { outline: ShieldCheckIconOutline, solid: ShieldCheckIconSolid }, label: 'Verify' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { icon: { outline: BellAlertIconOutline, solid: BellAlertIconSolid }, label: 'Review Queue' },
      { icon: { outline: ClockIconOutline, solid: ClockIconSolid }, label: 'Deadlines' },
      { icon: { outline: DocumentArrowUpIconOutline, solid: DocumentArrowUpIconSolid }, label: 'Upload' },
    ],
  },
  {
    label: 'Advanced',
    items: [
      { icon: { outline: BuildingLibraryIconOutline, solid: BuildingLibraryIconSolid }, label: 'Bench' },
      { icon: { outline: CodeBracketIconOutline, solid: CodeBracketIconSolid }, label: 'API' },
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
    : 'ormont-sidebar-nav__item'
  const children = (
    <>
      <span className="ormont-sidebar-nav__icon-wrap" aria-hidden="true">
        <OutlineIcon className="ormont-sidebar-nav__icon" />
        <SolidIcon className="ormont-sidebar-nav__icon ormont-sidebar-nav__icon--solid" />
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

export function SidebarNavigation({ currentPath }: { currentPath: string }) {
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())

  function toggleSection(label: string) {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(label)) {
        next.delete(label)
      } else {
        next.add(label)
      }
      return next
    })
  }

  return (
    <nav className="ormont-sidebar-nav" aria-label="Primary">
      {navSections.map((section, sectionIndex) => (
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
                active={item.to === '/workspace' ? currentPath === '/workspace' : currentPath.startsWith(item.to ?? '\u0000')}
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
