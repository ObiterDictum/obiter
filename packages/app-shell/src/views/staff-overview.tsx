import { StaffGate } from './staff-gate'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@obiter/ui'
import type { StaffOverviewResponse } from '@obiter/contracts'
import { formatRelativeTime } from '../format'
import { PageScaffold } from '../page-scaffold'
import { staffOverviewQueryOptions } from '../staff'
import { ErrorNotice } from './settings-fields'

export function StaffOverviewRouteView() {
  return (
    <StaffGate>
      <StaffOverview />
    </StaffGate>
  )
}

interface Figure {
  value: string
  label: string
}

interface OverviewCard {
  to: string
  title: string
  figures: Figure[]
  note?: string
}

function overviewCards(data: StaffOverviewResponse): OverviewCard[] {
  const { accessReview, feedback, accounts, organisations, activeUsers } = data
  return [
    {
      to: '/staff/access',
      title: 'Access review',
      figures: [{ value: String(accessReview.waiting), label: 'waiting' }],
      note:
        accessReview.waiting === 0
          ? 'Nobody is waiting for review'
          : accessReview.oldestWaitingAt
            ? `Oldest wait ${formatRelativeTime(accessReview.oldestWaitingAt)}`
            : undefined,
    },
    {
      to: '/staff/feedback',
      title: 'Feedback',
      figures: [{ value: String(feedback.unread), label: 'unread' }],
      note: feedback.unread === 0 ? 'No unread feedback' : 'Newest first',
    },
    {
      to: '/staff/usage',
      title: 'New accounts',
      figures: [
        { value: String(accounts.last7Days), label: 'last 7 days' },
        { value: String(accounts.last30Days), label: 'last 30 days' },
      ],
    },
    {
      to: '/staff/usage',
      title: 'New organisations',
      figures: [
        { value: String(organisations.last7Days), label: 'last 7 days' },
        { value: String(organisations.last30Days), label: 'last 30 days' },
      ],
    },
    {
      to: '/staff/usage',
      title: 'Active users',
      figures: [
        { value: String(activeUsers.today), label: 'today' },
        { value: String(activeUsers.last7Days), label: 'last 7 days' },
        { value: String(activeUsers.last30Days), label: 'last 30 days' },
      ],
    },
  ]
}

function FigureCard({ card }: { card: OverviewCard }) {
  return (
    <Link
      to={card.to}
      className="flex min-w-0 flex-col gap-3 rounded-lg bg-surface p-5 transition-colors hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="text-meta text-muted">{card.title}</span>
      <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        {card.figures.map((figure) => (
          <span key={figure.label} className="flex items-baseline gap-1.5">
            <span className="text-section text-ink tabular-nums">
              {figure.value}
            </span>
            <span className="text-caption text-subtle">{figure.label}</span>
          </span>
        ))}
      </span>
      {card.note ? (
        <span className="text-caption text-subtle">{card.note}</span>
      ) : null}
    </Link>
  )
}

function StaffOverview() {
  const overview = useQuery(staffOverviewQueryOptions())
  return (
    <PageScaffold
      title="Overview"
      description="The state of the service at a glance. Each figure opens the screen behind it."
    >
      {overview.isPending ? (
        <div className="grid gap-4 @pane:grid-cols-2 @pane-wide:grid-cols-3">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : overview.isError ? (
        <ErrorNotice message="Could not load the overview." />
      ) : (
        <div className="grid gap-4 @pane:grid-cols-2 @pane-wide:grid-cols-3">
          {overviewCards(overview.data).map((card) => (
            <FigureCard key={card.title} card={card} />
          ))}
        </div>
      )}
    </PageScaffold>
  )
}
