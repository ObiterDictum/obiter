import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import type { AppPlatform, MeResponse } from '@obiter/contracts'
import { useQuery } from '@tanstack/react-query'
import { CaretRight, Moon, Sun } from '@phosphor-icons/react'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  cn,
} from '@obiter/ui'
import { Fragment } from 'react'
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

/** "Owner · Harrington Vale LLP", or whichever half is known. */
function accountContext(me: MeResponse) {
  const role = me.user.role
    ? me.user.role.charAt(0).toUpperCase() + me.user.role.slice(1)
    : null
  return [role, me.organisation?.name].filter(Boolean).join(' · ')
}

/**
 * The account menu. Base UI Menu supplies the roles and the keyboard contract
 * the shell e2e spec asserts (Enter/Space/ArrowDown open into the list, arrows
 * and Home/End move, Escape closes and returns focus to the avatar, Tab or an
 * outside click closes); the trigger and popup carry only the visual layer.
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

  if (!me) return <Skeleton className="size-7 rounded-pill" />

  const context = accountContext(me)

  return (
    <Menu>
      <MenuTrigger
        aria-label="Account menu"
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-pill bg-brand text-caption font-medium text-brand-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        {initialsOf(me.user.name)}
      </MenuTrigger>
      <MenuContent aria-label="Account">
        {/* Whose account this is, not an action: presentation keeps the menu
            list a list of menuitems for screen readers. */}
        <div role="presentation" className="px-3 py-2">
          <p className="truncate text-item text-ink">{me.user.name}</p>
          <p className="break-all text-caption text-subtle">{me.user.email}</p>
          {context ? (
            <p className="mt-1 truncate text-caption text-subtle">{context}</p>
          ) : null}
        </div>
        <MenuSeparator />
        <MenuItem onClick={() => void navigate({ to: '/settings' })}>
          Account settings
        </MenuItem>
        <MenuItem
          onClick={() => {
            void signOut()
            void navigate({ to: '/sign-in' })
          }}
        >
          Sign out
        </MenuItem>
        <p
          role="presentation"
          className="px-3 pt-2 pb-1 text-caption text-subtle"
        >
          Obiter · {platform === 'desktop' ? 'Desktop' : 'Web'}
        </p>
      </MenuContent>
    </Menu>
  )
}
