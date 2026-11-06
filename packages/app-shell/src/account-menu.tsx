import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { AppPlatform, MeResponse } from '@obiter/contracts'
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  cn,
} from '@obiter/ui'
import { useAuth } from './auth'
import { currentUserQueryOptions } from './current-user'
import { initialsOf } from './format'

function accountContext(me: MeResponse) {
  const role = me.user.role
    ? me.user.role.charAt(0).toUpperCase() + me.user.role.slice(1)
    : null
  return [role, me.organisation?.name].filter(Boolean).join(' · ')
}

export function AccountMenu({ platform }: { platform: AppPlatform }) {
  const { data: me } = useQuery(currentUserQueryOptions())
  const navigate = useNavigate()
  const { signOut } = useAuth()

  if (!me) return <Skeleton className="size-7 rounded-pill" />

  const context = accountContext(me)

  return (
    <Menu>
      <MenuTrigger
        aria-label="Account menu"
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-pill bg-brand text-caption text-brand-fg',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        {initialsOf(me.user.name)}
      </MenuTrigger>
      <MenuContent aria-label="Account">
        <div role="presentation" className="px-3 py-2">
          <p className="truncate text-item text-ink">{me.user.name}</p>
          <p className="break-all text-caption text-subtle">{me.user.email}</p>
          {context ? (
            <p className="mt-1 truncate text-caption text-subtle">{context}</p>
          ) : null}
        </div>
        <MenuSeparator />
        <MenuItem
          onClick={() =>
            void navigate({ to: '/settings', search: { section: 'account' } })
          }
        >
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
