import {
  Folders,
  House,
  MagnifyingGlass,
  PencilSimple,
  Robot,
  ShieldCheck,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'

export type ModuleId =
  'home' | 'agent' | 'search' | 'matters' | 'verify' | 'redact'
export type ShellSection = ModuleId | 'settings' | 'other'

export interface ModuleItem {
  id: ModuleId
  label: string
  to?: string
  icon: (props: {
    size?: number
    weight?: 'regular' | 'fill'
    className?: string
    'aria-hidden'?: boolean
  }) => ReactNode
}

export const MODULES: ModuleItem[] = [
  { id: 'home', label: 'Home', to: '/', icon: House },
  { id: 'agent', label: 'Agent', icon: Robot },
  { id: 'search', label: 'Search', to: '/search', icon: MagnifyingGlass },
  { id: 'matters', label: 'Matters', to: '/matters', icon: Folders },
  { id: 'verify', label: 'Verify', to: '/verify', icon: ShieldCheck },
  { id: 'redact', label: 'Redact', to: '/redact', icon: PencilSimple },
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
  if (path === '/settings' || path.startsWith('/settings/')) return 'settings'
  return 'other'
}

const SECTION_LABELS = {
  home: 'Home',
  agent: 'Agent',
  search: 'Search',
  matters: 'Matters',
  verify: 'Verify',
  redact: 'Redact',
  settings: 'Settings',
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

export interface Crumb {
  label: string
  to?: string
}

export function breadcrumbTrail(
  path: string,
  matterName: string | null,
  sourceTitle: string | null = null,
): Crumb[] {
  const section = resolveSection(path)
  if (section === 'home') return [{ label: 'Home' }]

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
