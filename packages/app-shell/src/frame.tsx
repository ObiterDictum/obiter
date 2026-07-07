import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useNavigate, useRouterState } from '@tanstack/react-router'
import {
  Bookmark,
  CalendarBlank,
  Code,
  Folders,
  House,
  ListChecks,
  MagnifyingGlass,
  Moon,
  NotePencil,
  PencilSimple,
  Sun,
  Tray,
  UploadSimple,
  UserCircle,
} from '@phosphor-icons/react'
import { Button, Skeleton, ToastProvider, Toaster } from '@ormont/ui'
import type { AppPlatform } from '@ormont/contracts'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'

interface NavItem {
  label: string
  to?: string
  icon: ReactNode
  status: 'live' | 'planned'
}

const LIVE_NAV: NavItem[] = [
  { label: 'Home', to: '/workspace', icon: <House size={18} weight="regular" />, status: 'live' },
  { label: 'Search', to: '/search', icon: <MagnifyingGlass size={18} weight="regular" />, status: 'live' },
  { label: 'Matters', to: '/matters', icon: <Folders size={18} weight="regular" />, status: 'live' },
]

const PLANNED_NAV: NavItem[] = [
  { label: 'Documents', icon: <Tray size={18} weight="regular" />, status: 'planned' },
  { label: 'Redaction', icon: <PencilSimple size={18} weight="regular" />, status: 'planned' },
  { label: 'Verification', icon: <ListChecks size={18} weight="regular" />, status: 'planned' },
  { label: 'Review queue', icon: <Bookmark size={18} weight="regular" />, status: 'planned' },
  { label: 'Drafting', icon: <NotePencil size={18} weight="regular" />, status: 'planned' },
  { label: 'Research', icon: <MagnifyingGlass size={18} weight="regular" />, status: 'planned' },
  { label: 'Deadlines', icon: <CalendarBlank size={18} weight="regular" />, status: 'planned' },
  { label: 'Uploads', icon: <UploadSimple size={18} weight="regular" />, status: 'planned' },
  { label: 'Evaluation', icon: <UserCircle size={18} weight="regular" />, status: 'planned' },
  { label: 'Developer API', icon: <Code size={18} weight="regular" />, status: 'planned' },
]

const THEME_STORAGE_KEY = 'obiter.theme'

/**
 * App frame. Gates the shell on a real better-auth session: unauthenticated
 * users (off the auth routes) are redirected to /sign-in. Auth routes render
 * bare so the sign-in screen has no sidebar. Driven by real /api/me data.
 */
export function AppShellLayout({
  children,
  platform,
}: {
  children: ReactNode
  platform: AppPlatform
}) {
  const { session, isPending } = useAuth()
  const currentPath = useRouterState({ select: (state) => state.location.pathname })
  const isAuthRoute = currentPath === '/' || currentPath === '/sign-in'

  let body: ReactNode
  if (isAuthRoute) {
    body = children
  } else if (isPending) {
    body = <LoadingShell />
  } else if (!session) {
    body = <Navigate to="/sign-in" />
  } else {
    body = <AuthenticatedFrame platform={platform}>{children}</AuthenticatedFrame>
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
  return (
    <div className="grid min-h-dvh grid-cols-[minmax(248px,280px)_1fr] bg-canvas text-ink">
      <Sidebar platform={platform} />
      <div className="flex min-w-0 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
      </div>
    </div>
  )
}

function Sidebar({ platform }: { platform: AppPlatform }) {
  const currentPath = useRouterState({ select: (state) => state.location.pathname })
  const { data, isLoading } = useQuery(currentUserQueryOptions())

  return (
    <aside className="flex flex-col gap-6 border-r border-line bg-surface px-4 py-5">
      <div className="px-2">
        <span
          className="font-serif text-xl font-semibold tracking-[0.18em] text-ink"
          style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}
        >
          OBITER
        </span>
      </div>

      <nav className="flex flex-col gap-1" aria-label="Primary">
        {LIVE_NAV.map((item) => (
          <NavLink key={item.label} item={item} active={isActive(currentPath, item)} />
        ))}
      </nav>

      <div className="flex flex-col gap-1">
        <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-subtle">
          Planned
        </p>
        <nav className="flex flex-col gap-0.5" aria-label="Planned surfaces">
          {PLANNED_NAV.map((item) => (
            <NavLink key={item.label} item={item} active={false} />
          ))}
        </nav>
      </div>

      <div className="mt-auto">
        {isLoading || !data ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <UserCard
            name={data.user.name}
            email={data.user.email}
            orgName={data.organisation.name}
            platform={platform}
          />
        )}
      </div>
    </aside>
  )
}

function isActive(currentPath: string, item: NavItem) {
  return Boolean(item.to) && currentPath.startsWith(item.to as string)
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const className =
    'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ' +
    (active
      ? 'bg-brand text-brand-fg'
      : item.status === 'live'
        ? 'text-ink hover:bg-canvas'
        : 'text-muted hover:bg-canvas')

  if (item.status === 'planned') {
    return (
      <span className={className} aria-disabled="true" title={`${item.label} is planned`}>
        <span className="text-subtle">{item.icon}</span>
        <span className="flex-1">{item.label}</span>
        <span className="rounded-pill bg-canvas px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-subtle">
          Planned
        </span>
      </span>
    )
  }

  return (
    <Link to={item.to as string} className={className}>
      {item.icon}
      <span className="flex-1">{item.label}</span>
    </Link>
  )
}

function UserCard({
  name,
  email,
  orgName,
  platform,
}: {
  name: string
  email: string
  orgName: string
  platform: AppPlatform
}) {
  const navigate = useNavigate()
  const { signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    void navigate({ to: '/sign-in' })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-brand text-sm font-semibold text-brand-fg"
          aria-hidden="true"
        >
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          <p className="truncate text-xs text-muted">{orgName}</p>
        </div>
      </div>
      <p className="truncate text-xs text-subtle" title={email}>
        {email}
      </p>
      <p className="text-[10px] uppercase tracking-wide text-subtle">{platform} build</p>
      <Button variant="ghost" size="sm" className="mt-1 justify-start" onClick={handleSignOut}>
        Sign out
      </Button>
    </div>
  )
}

function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-line bg-surface px-8">
      <p className="text-sm text-muted">Obiter</p>
      <ThemeToggle />
    </header>
  )
}

function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => readInitialTheme())

  // Sync the theme attribute on <html>. A legitimate DOM-sync use of useEffect.
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
      className="rounded-md p-2 text-muted hover:bg-canvas hover:text-ink"
    >
      {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  )
}

function readInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') {
    return 'light'
  }
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === 'dark' ? 'dark' : 'light'
}

function LoadingShell() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="flex flex-col items-center gap-3 text-muted">
        <span
          className="font-serif text-2xl font-semibold tracking-[0.18em] text-ink"
          style={{ fontFamily: 'Cormorant Garamond, Georgia, serif' }}
        >
          OBITER
        </span>
        <Skeleton className="h-1 w-24" />
      </div>
    </div>
  )
}
