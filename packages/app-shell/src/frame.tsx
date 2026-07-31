import { useQuery } from '@tanstack/react-query'
import {
  Link,
  Navigate,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import {
  BookmarkSimple,
  Clock,
  FileText,
  Folders,
  House,
  ListChecks,
  MagnifyingGlass,
  Moon,
  PencilSimple,
  Sun,
  WarningCircle,
} from '@phosphor-icons/react'
import { Skeleton, ToastProvider, Toaster, cn } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useEffect, useState, type ReactNode } from 'react'
import { AgentWidget } from './agent-widget'
import { AppSearchField } from './app-search-field'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'
import { useMatterDocuments } from './documents'
import { useMattersList } from './matters'
import { isAttentionRun, useRedactionRunsList } from './redaction-runs'
import { THEME_STORAGE_KEY } from './use-app-theme'
import { getRecentLegalSearches } from './views/LegalSearchView'
import {
  lastPlaceFromPath,
  writeWorkspaceLastPlace,
} from './workspace-continuity'
import { ObiterMark, Wordmark } from './wordmark'

interface ModeItem {
  label: string
  to: string
  icon: PhosphorIcon
  status: 'live' | 'soon'
}

type PhosphorIcon = (props: {
  size?: number
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone'
  className?: string
  'aria-hidden'?: boolean
}) => ReactNode

const MODE_NAV: ModeItem[] = [
  { label: 'Search', to: '/search', icon: MagnifyingGlass, status: 'live' },
  { label: 'Matters', to: '/matters', icon: Folders, status: 'live' },
  { label: 'Verify', to: '/verify', icon: ListChecks, status: 'soon' },
  { label: 'Redact', to: '/redact', icon: PencilSimple, status: 'live' },
]

/**
 * App frame. Gates the shell on a real better-auth session: unauthenticated
 * users are redirected to /sign-in. Auth routes render bare (no workspace
 * chrome). Authenticated chrome matches the marketing workspace demo:
 * top modes (content column), hover-expand rail, app-wide search, floating Agent.
 */
export function AppShellLayout({
  children,
  platform,
}: {
  children: ReactNode
  platform: AppPlatform
}) {
  const { session, isPending } = useAuth()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const isAuthRoute =
    currentPath === '/sign-in' ||
    currentPath === '/forgot-password' ||
    currentPath === '/reset-password'

  let body: ReactNode

  if (isAuthRoute) {
    body = children
  } else if (isPending) {
    body = <LoadingShell />
  } else if (!session) {
    body = <Navigate to="/sign-in" />
  } else {
    body = (
      <AuthenticatedFrame platform={platform}>{children}</AuthenticatedFrame>
    )
  }

  return (
    <ToastProvider>
      {body}
      <Toaster />
    </ToastProvider>
  )
}

function AuthenticatedFrame({
  children,
  platform,
}: {
  children: ReactNode
  platform: AppPlatform
}) {
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const mode = resolveMode(currentPath)

  useEffect(() => {
    const place = lastPlaceFromPath(currentPath)
    if (!place || typeof window === 'undefined') return
    writeWorkspaceLastPlace(window.sessionStorage, place)
  }, [currentPath])

  return (
    <div className="flex h-dvh bg-canvas text-ink">
      <ModeRail mode={mode} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar platform={platform} mode={mode} />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <AgentWidget />
    </div>
  )
}

type ModeId = 'home' | 'search' | 'matters' | 'verify' | 'redact' | 'other'

function resolveMode(path: string): ModeId {
  if (path === '/') return 'home'
  if (
    path === '/search' ||
    path.startsWith('/case/') ||
    path.startsWith('/cases/')
  )
    return 'search'
  if (path === '/matters' || path.startsWith('/matters/')) return 'matters'
  if (path === '/verify' || path.startsWith('/verify/')) return 'verify'
  if (path === '/redact' || path.startsWith('/redact/')) return 'redact'
  return 'other'
}

function TopBar({ platform, mode }: { platform: AppPlatform; mode: ModeId }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link
          to="/"
          aria-label="Home"
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md text-muted transition-[color,background-color] duration-200',
            mode === 'home'
              ? 'bg-raised text-ink'
              : 'hover:bg-raised hover:text-ink',
          )}
        >
          <House size={16} weight={mode === 'home' ? 'fill' : 'regular'} />
        </Link>
        <nav className="flex items-center gap-0.5" aria-label="Modes">
          {MODE_NAV.map((item) => {
            const active =
              (item.to === '/search' && mode === 'search') ||
              (item.to === '/matters' && mode === 'matters') ||
              (item.to === '/verify' && mode === 'verify') ||
              (item.to === '/redact' && mode === 'redact')
            const Icon = item.icon
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-[color,background-color] duration-200',
                  active
                    ? 'bg-raised text-ink'
                    : 'text-muted hover:bg-raised/60 hover:text-ink',
                )}
              >
                <Icon
                  size={14}
                  weight={active ? 'fill' : 'regular'}
                  aria-hidden
                />
                {item.label}
                {item.status === 'soon' ? (
                  <span className="text-[10px] font-normal text-subtle">
                    Soon
                  </span>
                ) : null}
              </Link>
            )
          })}
        </nav>
      </div>

      <AppSearchField />

      <div className="flex min-w-0 flex-1 items-center justify-end gap-1">
        <ThemeToggle />
        <UserMenu platform={platform} />
      </div>
    </header>
  )
}

type RailItem = {
  id: string
  label: string
  icon: PhosphorIcon
  to?: string
  note?: string
  onClick?: () => void
  muted?: boolean
}

type RailSection = {
  title: string
  items: RailItem[]
}

function ModeRail({ mode }: { mode: ModeId }) {
  const navigate = useNavigate()
  const currentPath = useRouterState({
    select: (state) => state.location.pathname,
  })
  const sections = useModeRailSections(mode, currentPath, navigate)
  const expandable = sections.length > 0
  const [navVisible, setNavVisible] = useState(expandable)

  useEffect(() => {
    if (!expandable) {
      setNavVisible(false)
      return
    }
    setNavVisible(false)
    const frame = window.requestAnimationFrame(() => setNavVisible(true))
    return () => window.cancelAnimationFrame(frame)
  }, [mode, expandable])

  return (
    <aside
      className={cn(
        'group/rail relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-r border-line bg-canvas',
        'w-12 transition-[width] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
        expandable && 'hover:w-64 focus-within:w-64',
      )}
      aria-label={expandable ? 'Mode shortcuts' : 'Obiter'}
    >
      {/* Fixed inner width so icons stay left-aligned while the rail clips/expands. */}
      <div className="flex h-full w-64 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-line px-3.5">
          <Link to="/" aria-label="Home" className="shrink-0">
            <ObiterMark className="h-5 w-5" />
          </Link>
          <span
            className={cn(
              'truncate text-[11px] font-semibold tracking-[0.14em] text-muted uppercase',
              'opacity-0 transition-opacity duration-200',
              expandable &&
                'group-hover/rail:opacity-100 group-focus-within/rail:opacity-100',
            )}
          >
            {modeLabel(mode)}
          </span>
        </div>

        <nav
          className={cn(
            'flex flex-1 flex-col gap-5 overflow-y-auto px-2 py-3',
            'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]',
            navVisible
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none translate-y-1 opacity-0',
          )}
          aria-hidden={!expandable}
        >
          {sections.map((section) => (
            <div key={section.title} className="flex flex-col gap-0.5">
              <p
                className={cn(
                  'h-5 overflow-hidden whitespace-nowrap px-2.5 text-[10px] font-medium tracking-wider text-subtle uppercase',
                  'opacity-0 transition-opacity duration-200',
                  'group-hover/rail:opacity-100 group-focus-within/rail:opacity-100',
                )}
              >
                {section.title}
              </p>
              {section.items.map((item) => (
                <RailItemRow
                  key={item.id}
                  item={item}
                  currentPath={currentPath}
                />
              ))}
            </div>
          ))}
        </nav>
      </div>
    </aside>
  )
}

function RailItemRow({
  item,
  currentPath,
}: {
  item: RailItem
  currentPath: string
}) {
  const Icon = item.icon
  const active = item.to
    ? item.to === '/'
      ? currentPath === '/'
      : currentPath === item.to || currentPath.startsWith(`${item.to}/`)
    : false
  const rowClass = cn(
    'flex min-h-9 items-center gap-3 rounded-md px-2.5 py-1.5 text-left transition-[color,background-color] duration-150',
    item.muted
      ? 'text-subtle'
      : active
        ? 'bg-raised text-ink'
        : 'text-muted hover:bg-raised/70 hover:text-ink',
  )
  const body = (
    <>
      <Icon
        size={18}
        weight={active && !item.muted ? 'fill' : 'regular'}
        className="shrink-0"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px]">{item.label}</span>
        {item.note ? (
          <span className="block truncate text-[10px] text-subtle">
            {item.note}
          </span>
        ) : null}
      </span>
    </>
  )

  if (item.to) {
    return (
      <Link
        to={item.to}
        title={item.label}
        aria-label={item.label}
        aria-current={active ? 'page' : undefined}
        className={rowClass}
      >
        {body}
      </Link>
    )
  }

  if (item.onClick) {
    return (
      <button
        type="button"
        title={item.label}
        aria-label={item.label}
        className={rowClass}
        onClick={item.onClick}
      >
        {body}
      </button>
    )
  }

  return (
    <span title={item.label} className={rowClass}>
      {body}
    </span>
  )
}

function modeLabel(mode: ModeId) {
  switch (mode) {
    case 'home':
      return 'Home'
    case 'search':
      return 'Search'
    case 'matters':
      return 'Matters'
    case 'verify':
      return 'Verify'
    case 'redact':
      return 'Redact'
    default:
      return 'Obiter'
  }
}

function useModeRailSections(
  mode: ModeId,
  currentPath: string,
  navigate: ReturnType<typeof useNavigate>,
): RailSection[] {
  const mattersQuery = useMattersList({
    enabled: mode === 'matters',
  })
  const runsQuery = useRedactionRunsList({
    enabled: mode === 'redact',
  })
  const matterId = matterIdFromPath(currentPath)
  const documentsQuery = useMatterDocuments(matterId ?? '', {
    enabled: mode === 'matters' && Boolean(matterId),
  })
  const recentSearches =
    typeof window === 'undefined'
      ? []
      : getRecentLegalSearches(window.sessionStorage)

  const matters = mattersQuery.data ?? []
  const activeMatters = matters.filter((matter) => matter.status === 'active')
  const archivedMatters = matters.filter(
    (matter) => matter.status === 'archived',
  )
  const runs = runsQuery.data?.runs ?? []
  const pendingRuns = runs.filter((run) => isAttentionRun(run.status))
  const documents = documentsQuery.data ?? []

  switch (mode) {
    case 'home':
      // Home has no mode rail — the desk already surfaces attention, matters,
      // and mode entry points; shortcuts would only duplicate the top bar.
      return []
    case 'search':
      return [
        {
          title: 'Search',
          items: [
            {
              id: 'search-new',
              label: 'New search',
              to: '/search',
              icon: MagnifyingGlass,
            },
          ],
        },
        {
          title: 'Recent queries',
          items:
            recentSearches.length > 0
              ? recentSearches.map((query) => ({
                  id: `recent-${query}`,
                  label: query,
                  icon: Clock,
                  onClick: () => {
                    window.sessionStorage.setItem(
                      'obiter.search.initialQuery',
                      query,
                    )
                    void navigate({ to: '/search' })
                  },
                }))
              : [
                  {
                    id: 'recent-empty',
                    label: 'No recent queries',
                    icon: Clock,
                    muted: true,
                  },
                ],
        },
        {
          title: 'Opened',
          items: [
            {
              id: 'opened-empty',
              label: 'No judgments opened',
              note: 'Open a result from search',
              icon: FileText,
              muted: true,
            },
          ],
        },
        {
          title: 'Saved',
          items: [
            {
              id: 'saved-empty',
              label: 'No saved searches',
              note: 'Coming soon',
              icon: BookmarkSimple,
              muted: true,
            },
          ],
        },
      ]
    case 'matters':
      return [
        {
          title: 'Active',
          items:
            activeMatters.length > 0
              ? activeMatters.map((matter) => ({
                  id: `active-${matter.id}`,
                  label: matter.name,
                  note: matter.clientReference || undefined,
                  to: `/matters/${matter.id}`,
                  icon: Folders,
                }))
              : [
                  {
                    id: 'active-empty',
                    label: 'No active matters',
                    to: '/matters',
                    icon: Folders,
                    muted: true,
                  },
                ],
        },
        {
          title: 'Archived',
          items:
            archivedMatters.length > 0
              ? archivedMatters.map((matter) => ({
                  id: `archived-${matter.id}`,
                  label: matter.name,
                  to: `/matters/${matter.id}`,
                  icon: Folders,
                  muted: true,
                }))
              : [
                  {
                    id: 'archived-empty',
                    label: 'None archived',
                    icon: Folders,
                    muted: true,
                  },
                ],
        },
        {
          title: 'In this matter',
          items: matterId
            ? documents.length > 0
              ? documents.slice(0, 8).map((document) => ({
                  id: `doc-${document.id}`,
                  label:
                    document.currentVersion?.filename ?? document.logicalKey,
                  note: document.currentVersion?.documentStatus,
                  to: `/matters/${matterId}/documents/${document.id}`,
                  icon: FileText,
                }))
              : [
                  {
                    id: 'docs-empty',
                    label: 'No documents yet',
                    note: 'Upload from the matter desk',
                    icon: FileText,
                    muted: true,
                  },
                ]
            : [
                {
                  id: 'docs-select',
                  label: 'Select a matter',
                  note: 'Documents appear here',
                  icon: FileText,
                  muted: true,
                },
              ],
        },
      ]
    case 'verify':
      return [
        {
          title: 'Runs',
          items: [
            {
              id: 'verify-overview',
              label: 'Overview',
              to: '/verify',
              icon: ListChecks,
            },
            {
              id: 'verify-empty',
              label: 'No verification runs',
              note: 'In development',
              icon: Clock,
              muted: true,
            },
          ],
        },
        {
          title: 'Needs review',
          items: [
            {
              id: 'verify-review-empty',
              label: 'Nothing to review',
              note: 'Claims will list here',
              icon: WarningCircle,
              muted: true,
            },
          ],
        },
        {
          title: 'Sources',
          items: [
            {
              id: 'verify-sources-empty',
              label: 'No linked sources',
              note: 'Evidence appears with a claim',
              icon: FileText,
              muted: true,
            },
          ],
        },
      ]
    case 'redact':
      return [
        {
          title: 'Runs',
          items:
            runs.length > 0
              ? runs.slice(0, 10).map((run) => ({
                  id: `run-${run.id}`,
                  label: run.sourceFilename,
                  note: run.matterName
                    ? `Matter · ${run.matterName}`
                    : run.status.replaceAll('_', ' '),
                  to: `/redact/${run.id}`,
                  icon: PencilSimple,
                }))
              : [
                  {
                    id: 'runs-empty',
                    label: 'No redaction runs',
                    note: 'Create one from Redact',
                    to: '/redact',
                    icon: PencilSimple,
                    muted: true,
                  },
                ],
        },
        {
          title: 'Pending',
          items:
            pendingRuns.length > 0
              ? pendingRuns.slice(0, 6).map((run) => ({
                  id: `pending-${run.id}`,
                  label: run.sourceFilename,
                  note: run.status.replaceAll('_', ' '),
                  to: `/redact/${run.id}`,
                  icon: WarningCircle,
                }))
              : [
                  {
                    id: 'pending-empty',
                    label: 'Nothing pending',
                    icon: Clock,
                    muted: true,
                  },
                ],
        },
      ]
    default:
      return [
        {
          title: 'Navigate',
          items: [
            { id: 'nav-home', label: 'Home', to: '/', icon: House },
            {
              id: 'nav-search',
              label: 'Search',
              to: '/search',
              icon: MagnifyingGlass,
            },
          ],
        },
      ]
  }
}

function matterIdFromPath(path: string): string | null {
  const match = path.match(/^\/matters\/([^/]+)/)
  return match?.[1] ?? null
}

function UserMenu({ platform }: { platform: AppPlatform }) {
  const { data, isLoading } = useQuery(currentUserQueryOptions())
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    void navigate({ to: '/sign-in' })
  }

  if (isLoading || !data) {
    return <Skeleton className="h-8 w-8 rounded-pill" />
  }

  const initial = data.user.name.charAt(0).toUpperCase()

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-pill bg-brand text-xs font-semibold text-brand-fg"
      >
        {initial}
      </button>
      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-50 mt-2 w-56 rounded-[0.55rem] border border-line bg-raised p-2 shadow-lg"
          >
            <div className="border-b border-line px-2 pb-2 mb-1">
              <p className="truncate text-sm font-medium text-ink">
                {data.user.name}
              </p>
              <p className="truncate text-xs text-muted">{data.user.email}</p>
              {data.organisation?.name ? (
                <p className="mt-1 truncate text-xs text-subtle">
                  {data.organisation.name}
                </p>
              ) : null}
              <p className="mt-1 text-[10px] uppercase tracking-wide text-subtle">
                {platform}
              </p>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void navigate({ to: '/settings' })
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Settings
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void handleSignOut()
              }}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-surface hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readInitialTheme())

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
  }, [theme])

  const next = theme === 'light' ? 'dark' : 'light'
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} theme`}
      onClick={() => setTheme(next)}
      className="rounded-md p-2 text-muted transition-colors duration-200 hover:bg-raised hover:text-ink"
    >
      {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  )
}

function readInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'dark'
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  // Night is the product default. Only an explicit "light" preference opts out.
  // (v2 storage key drops the old cream-era default that stuck many sessions on light.)
  return stored === 'light' ? 'light' : 'dark'
}

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-4">
        <Wordmark className="text-base" />
        <Skeleton className="h-1 w-24" />
      </div>
    </div>
  )
}
