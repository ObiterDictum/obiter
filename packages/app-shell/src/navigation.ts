import {
  Folders,
  House,
  MagnifyingGlass,
  PencilSimple,
  ShieldCheck,
  Robot,
} from '@obiter/ui/icons/shell'
import type { ReactNode } from 'react'

export type ModuleId =
  'home' | 'search' | 'matters' | 'verify' | 'redact' | 'agent'
export type ShellSection = ModuleId | 'settings' | 'staff' | 'other'

export interface ModuleItem {
  id: ModuleId
  label: string
  to: string
  icon: (props: {
    size?: number
    weight?: 'regular' | 'fill'
    className?: string
    'aria-hidden'?: boolean
  }) => ReactNode
}

export const MODULES: ModuleItem[] = [
  { id: 'home', label: 'Home', to: '/', icon: House },
  { id: 'matters', label: 'Matters', to: '/matters', icon: Folders },
  { id: 'search', label: 'Search', to: '/search', icon: MagnifyingGlass },
  { id: 'verify', label: 'Verify', to: '/verify', icon: ShieldCheck },
  { id: 'redact', label: 'Redact', to: '/redact', icon: PencilSimple },
  { id: 'agent', label: 'Agent', to: '/agent', icon: Robot },
]

export function resolveSection(path: string): ShellSection {
  if (path === '/' || path === '/workspace') return 'home'
  if (
    path === '/search' ||
    path.startsWith('/case/') ||
    path.startsWith('/cases/') ||
    path.startsWith('/ln/')
  )
    return 'search'
  if (path === '/matters' || path.startsWith('/matters/')) return 'matters'
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify'
  if (path === '/redact' || path.startsWith('/redact/')) return 'redact'
  if (path === '/agent' || path.startsWith('/agent/')) return 'agent'
  if (path === '/staff' || path.startsWith('/staff/')) return 'staff'
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings'
  return 'other'
}

const SECTION_LABELS = {
  home: 'Home',
  search: 'Search',
  matters: 'Matters',
  verify: 'Verify',
  redact: 'Redact',
  agent: 'Agent',
  settings: 'Settings',
  staff: 'Staff',
  other: 'Obiter',
} satisfies Record<ShellSection, string>

function sectionLabel(section: ShellSection): string {
  return SECTION_LABELS[section]
}

function sectionPath(section: ShellSection): string | null {
  return MODULES.find((module) => module.id === section)?.to ?? null
}

export function matterIdFromPath(path: string): string | null {
  return path.match(/^\/matters\/([^/]+)/)?.[1] ?? null
}

export function documentIdFromPath(path: string): string | null {
  return path.match(/^\/matters\/[^/]+\/documents\/([^/]+)/)?.[1] ?? null
}

export interface Crumb {
  label: string
  to?: string
}

const STAFF_SCREENS = new Map([
  ['/staff', 'Overview'],
  ['/staff/access', 'Access review'],
  ['/staff/usage', 'Usage'],
  ['/staff/feedback', 'Feedback'],
])

export function staffScreenLabel(path: string): string {
  return STAFF_SCREENS.get(path) ?? 'Page not found'
}

export interface BreadcrumbOptions {
  settingsSection?: string
  staff?: boolean
}

export function breadcrumbTrail(
  path: string,
  matterName: string | null,
  sourceTitle: string | null = null,
  options: BreadcrumbOptions = {},
): Crumb[] {
  const section = resolveSection(path)
  if (section === 'home') return [{ label: 'Home' }]
  if (section === 'staff') {
    if (options.staff === false) return [{ label: 'Page not found' }]
    return [{ label: 'Staff', to: '/staff' }, { label: staffScreenLabel(path) }]
  }
  if (section === 'settings') {
    const crumbs: Crumb[] = [{ label: 'Settings' }]
    if (options.settingsSection) crumbs.push({ label: options.settingsSection })
    return crumbs
  }

  const modulePath = sectionPath(section)
  const sectionCrumb: Crumb = modulePath
    ? { label: sectionLabel(section), to: modulePath }
    : { label: sectionLabel(section) }

  if (section === 'matters' && path !== '/matters') {
    return [sectionCrumb, { label: matterName ?? 'Matter' }]
  }
  if (section === 'other') return [{ label: 'Page not found' }]
  if (section === 'search' && path !== '/search' && sourceTitle) {
    return [
      { label: sectionLabel(section), to: modulePath ?? '/search' },
      { label: sourceTitle },
    ]
  }
  return [{ ...sectionCrumb, to: undefined }]
}
