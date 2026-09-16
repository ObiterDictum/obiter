import { useQuery } from '@tanstack/react-query'
import {
  Link,
  Navigate,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router'
import { House, Moon, Sun } from '@phosphor-icons/react'
import { Skeleton, ToastProvider, Toaster, cn } from '@obiter/ui'
import type { AppPlatform } from '@obiter/contracts'
import { useEffect, useState, type ReactNode } from 'react'
import { AgentWidget } from './agent-widget'
import { AppSearchField } from './app-search-field'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'
import { THEME_STORAGE_KEY } from './use-app-theme'
import {
  lastPlaceFromPath,
  writeWorkspaceLastPlace,
} from './workspace-continuity'
import { Wordmark } from './wordmark'
import { ModeRail } from './mode-rail'
import { TopModeNav, resolveMode, type ModeId } from './mode-navigation'

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
    currentPath === '/sign-up' ||
    currentPath === '/forgot-password' ||
    currentPath === '/reset-password' ||
    currentPath === '/invites/accept'

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

function TopBar({ platform, mode }: { platform: AppPlatform; mode: ModeId }) {
  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link
          to="/"
          aria-label="Home"
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-[color,background-color] duration-200',
            mode === 'home'
              ? 'bg-raised text-ink'
              : 'hover:bg-raised hover:text-ink',
          )}
        >
          <House size={16} weight={mode === 'home' ? 'fill' : 'regular'} />
        </Link>
        <TopModeNav mode={mode} />
      </div>

      <AppSearchField />

      <div className="flex min-w-0 shrink-0 items-center justify-end gap-1 sm:flex-1">
        <ThemeToggle />
        <UserMenu platform={platform} />
      </div>
    </header>
  )
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
