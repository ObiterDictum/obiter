import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@obiter/ui'
import { ArrowsClockwise, ChatText, GridNine } from '@obiter/ui/icons'
import { CaretRight, ShieldCheck } from '@obiter/ui/icons/shell'
import { useCurrentUser } from './current-user'
import { rowClass } from './contents-sections'
import { staffOverviewQueryOptions } from './staff'

const STAFF_SECTIONS = [
  { to: '/staff', label: 'Overview', icon: GridNine },
  { to: '/staff/access', label: 'Access review', icon: ShieldCheck },
  { to: '/staff/usage', label: 'Usage', icon: ArrowsClockwise },
  { to: '/staff/feedback', label: 'Feedback', icon: ChatText },
  { to: '/staff/errors', label: 'Errors', icon: ArrowsClockwise },
] as const

export function StaffContents({ pathname }: { pathname: string }) {
  const { data: me } = useCurrentUser()
  const overview = useQuery({
    ...staffOverviewQueryOptions(),
    enabled: me.isStaff === true,
  })
  if (!me.isStaff) return null
  const counts = new Map([
    ['/staff/access', overview.data?.accessReview.waiting],
    ['/staff/feedback', overview.data?.feedback.unread],
  ])
  return (
    <nav
      aria-label="Staff sections"
      className="flex flex-col gap-px px-1.5 pt-1"
    >
      {STAFF_SECTIONS.map(({ to, label, icon: Icon }) => {
        const current = pathname === to
        const count = counts.get(to)
        return (
          <Link
            key={to}
            to={to}
            aria-current={current ? 'page' : undefined}
            className={cn(rowClass(current), 'gap-2.5')}
          >
            <Icon size={16} aria-hidden className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {count ? (
              <span
                aria-hidden
                className="shrink-0 text-caption tabular-nums text-subtle"
              >
                {count}
              </span>
            ) : null}
            {current ? (
              <CaretRight size={12} aria-hidden className="text-subtle" />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}
