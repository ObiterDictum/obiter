import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import type { AppPlatform, MeResponse } from '@obiter/contracts'
import { useQuery } from '@tanstack/react-query'
import { CaretRight, Moon, Sun } from '@phosphor-icons/react'
import { Skeleton, cn } from '@obiter/ui'
import { Fragment, useEffect, useRef, useState } from 'react'
import { AppSearchField } from './app-search-field'
import { useAuth } from './auth'
import { ContentFrame } from './content-frame'
import { currentUserQueryOptions } from './current-user'
import { useMattersList } from './matters'
import { breadcrumbTrail, matterIdFromPath } from './navigation'
import { setAppTheme, useAppTheme } from './use-app-theme'

/**
 * The top bar: where you are, app-wide search, the theme choice and the account.
 * It shares the content column with every page, so the breadcrumb starts on the
 * same x as the page title.
 */
export function TopBar({ platform }: { platform: AppPlatform }) {
  const { data: me } = useQuery(currentUserQueryOptions())
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const matters = useMattersList().data ?? []
  const currentMatterId = matterIdFromPath(pathname)
  const matterName =
    matters.find((matter) => matter.id === currentMatterId)?.name ?? null
  const trail = breadcrumbTrail(pathname, matterName)

  return (
    <header className="shrink-0 bg-canvas">
      <ContentFrame className="flex h-12 items-center gap-3">
        <nav
          aria-label="Breadcrumb"
          className="flex min-w-0 flex-1 items-center gap-2 text-meta whitespace-nowrap"
        >
          {me?.organisation ? (
            <>
              <Link
                to="/"
                className="max-w-[16rem] truncate text-subtle hover:text-ink"
              >
                {me.organisation.name}
              </Link>
              <CrumbSeparator />
            </>
          ) : null}
          {trail.map((crumb, index) => (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? <CrumbSeparator /> : null}
              {crumb.to ? (
                <Link
                  to={crumb.to}
                  className="max-w-[18rem] truncate text-subtle hover:text-ink"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="max-w-[24rem] truncate text-ink">
                  {crumb.label}
                </span>
              )}
            </Fragment>
          ))}
        </nav>

        <AppSearchField />
        <ThemeToggle />
        <AccountMenu platform={platform} me={me} />
      </ContentFrame>
    </header>
  )
}

function CrumbSeparator() {
  return (
    <CaretRight
      size={12}
      aria-hidden
      className="shrink-0 text-subtle opacity-60"
    />
  )
}

const iconButtonClass =
  'grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function ThemeToggle() {
  const theme = useAppTheme()
  const next = theme === 'light' ? 'dark' : 'light'
  const label = `Switch to ${next} theme`
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setAppTheme(next)}
      className={iconButtonClass}
    >
      {theme === 'light' ? (
        <Moon size={16} aria-hidden />
      ) : (
        <Sun size={16} aria-hidden />
      )}
    </button>
  )
}

function initialsOf(name: string) {
  const words = name.split(/\s+/).filter(Boolean)
  const first = words[0]?.[0] ?? '?'
  const last = words.length > 1 ? words[words.length - 1][0] : ''
  return `${first}${last}`.toUpperCase()
}

const menuItemClass =
  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-item text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring'

/** "Owner · Harrington Vale LLP", or whichever half is known. */
function accountContext(me: MeResponse) {
  const role = me.user.role
    ? me.user.role.charAt(0).toUpperCase() + me.user.role.slice(1)
    : null
  return [role, me.organisation?.name].filter(Boolean).join(' · ')
}

/**
 * The account menu. A disclosure rather than a floating-library popover: this
 * is the only menu in the shell and the frame is on a hard bundle budget, so
 * the keyboard contract is implemented here and covered by the shell e2e spec:
 * Enter/Space/ArrowDown open and move into the list, Arrow keys and Home/End
 * move between items, Escape closes and returns focus to the avatar, and Tab
 * or a click elsewhere closes it.
 */
function AccountMenu({
  platform,
  me,
}: {
  platform: AppPlatform
  me?: MeResponse
}) {
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Focus moves into the menu when it opens, and a pointer press outside it
  // closes it. Both are document-level browser events, not React state.
  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector('button')?.focus()
    function onPointerDown(event: MouseEvent) {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  if (!me) return <Skeleton className="size-7 rounded-pill" />

  const context = accountContext(me)

  function close() {
    setOpen(false)
    triggerRef.current?.focus()
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'Tab') {
      setOpen(false)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = [...(menuRef.current?.querySelectorAll('button') ?? [])]
    if (items.length === 0) return
    event.preventDefault()
    // SAFETY: the list was queried for `button` elements, so the focused node
    // can only be one of them or something outside the menu (index -1).
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowDown'
            ? (current + 1) % items.length
            : (current - 1 + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'grid size-7 place-items-center rounded-pill bg-brand text-caption font-medium text-brand-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        {initialsOf(me.user.name)}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id="account-menu"
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKeyDown}
          className="absolute top-8 right-0 z-50 w-72 rounded-lg border border-line bg-raised p-2 shadow-lg"
        >
          <div className="px-3 py-2">
            <p className="truncate text-item text-ink">{me.user.name}</p>
            <p className="break-all text-caption text-subtle">
              {me.user.email}
            </p>
            {context ? (
              <p className="mt-1 truncate text-caption text-subtle">
                {context}
              </p>
            ) : null}
          </div>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onClick={() => {
              setOpen(false)
              void navigate({ to: '/settings' })
            }}
          >
            Account settings
          </button>
          <button
            type="button"
            role="menuitem"
            className={menuItemClass}
            onClick={() => {
              setOpen(false)
              void signOut()
              void navigate({ to: '/sign-in' })
            }}
          >
            Sign out
          </button>
          <p className="px-3 pt-2 pb-1 text-caption text-subtle">
            Obiter · {platform === 'desktop' ? 'Desktop' : 'Web'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
