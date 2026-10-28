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
  /** Absent for a entry that opens a panel rather than a route. */
  to?: string
  icon: (props: {
    size?: number
    weight?: 'regular' | 'fill'
    className?: string
    'aria-hidden'?: boolean
  }) => ReactNode
}

/**
 * The workspace modules, in the sidebar's order. Agent has no route yet: it
 * opens the panel that says the agent is coming, so the shell never offers a
 * route that does not exist.
 */
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

/** The link a module crumb points at, or null when the section has no index. */
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

/**
 * The breadcrumb trail below the organisation, which is the top bar's first
 * crumb and always links home. A matter page names the matter once the matters
 * list (already loaded for the sidebar) knows it; until then it falls back to
 * the module name rather than showing an id. A source page names the source
 * once its own query answers, for the same reason.
 */
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
  // An address the shell does not know ends at the page itself rather than at a
  // separator with nothing after it.
  if (section === 'other') return [{ label: 'Page not found' }]
  // A judgment or provision page sits under Search, so the trail keeps the
  // link back to the results and names what is open.
  if (section === 'search' && path !== '/search' && sourceTitle) {
    return [
      { label: sectionLabel(section), to: modulePath ?? '/search' },
      { label: sourceTitle },
    ]
  }
  return [{ ...sectionCrumb, to: undefined }]
}
