import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { CaretDown, CaretUp } from '@obiter/ui/icons'
import { Skeleton, cn } from '@obiter/ui'
import type { StaffOverviewResponse, StaffUsageWeek } from '@obiter/contracts'
import { useCurrentUser } from '../current-user'
import { formatRelativeTime } from '../format'
import { PageScaffold } from '../page-scaffold'
import { ShellNotFound } from '../shell-states'
import { staffOverviewQueryOptions, staffUsageQueryOptions } from '../staff'
import { ErrorNotice } from './settings-fields'
import { SERIES_COLOURS, weekDelta } from './staff-chart-data'
import { Sparkline } from './staff-sparkline'

const SPARKLINE_WEEKS = 12

export function StaffOverviewRouteView() {
  const { data: me } = useCurrentUser()
  if (!me.isStaff) return <ShellNotFound />
  return <StaffOverview />
}

interface OverviewDelta {
  direction: 'up' | 'down' | 'flat'
  amount: number
}

interface OverviewTile {
  to: string
  title: string
  value: string
  caption?: string
  note?: string
  delta?: OverviewDelta
  trend?: { values: number[]; colour: string }
}

function weekValues(
  weeks: StaffUsageWeek[] | undefined,
  pick: (week: StaffUsageWeek) => number,
): number[] | undefined {
  return weeks?.map(pick)
}

function tileDelta(values: number[] | undefined): OverviewDelta | undefined {
  const delta = values ? weekDelta(values) : null
  if (delta === null) return undefined
  return {
    direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    amount: Math.abs(delta),
  }
}

function trendTile(
  to: string,
  title: string,
  value: string,
  weeks: StaffUsageWeek[] | undefined,
  pick: (week: StaffUsageWeek) => number,
  colour: string,
): OverviewTile {
  const values = weekValues(weeks, pick)
  return {
    to,
    title,
    value,
    caption: 'last 7 days',
    delta: tileDelta(values),
    trend: { values: values ?? [], colour },
  }
}

function overviewTiles(
  data: StaffOverviewResponse,
  weeks: StaffUsageWeek[] | undefined,
) {
  const { accessReview, feedback, accounts, organisations, activeUsers } = data
  return {
    trends: [
      trendTile(
        '/staff/usage',
        'Active users',
        String(activeUsers.last7Days),
        weeks,
        (week) => week.activeUsers,
        SERIES_COLOURS[0],
      ),
      trendTile(
        '/staff/usage',
        'New accounts',
        String(accounts.last7Days),
        weeks,
        (week) => week.newAccounts,
        SERIES_COLOURS[1],
      ),
    ],
    figures: [
      {
        to: '/staff/access',
        title: 'Access review',
        value: String(accessReview.waiting),
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
        value: String(feedback.unread),
        note: feedback.unread === 0 ? 'No unread feedback' : 'Newest first',
      },
      {
        to: '/staff/usage',
        title: 'New organisations',
        value: String(organisations.last7Days),
        caption: 'last 7 days',
        note: `${organisations.last30Days} in the last 30 days`,
      },
    ],
  }
}

function DeltaMark({ delta }: { delta: OverviewDelta }) {
  const tone =
    delta.direction === 'up'
      ? 'text-ink'
      : delta.direction === 'down'
        ? 'text-muted'
        : 'text-subtle'
  const label =
    delta.direction === 'flat'
      ? 'No change on the previous week'
      : `${delta.direction === 'up' ? 'Up' : 'Down'} ${delta.amount} on the previous week`
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-caption', tone)}>
      {delta.direction === 'up' ? (
        <CaretUp size={10} aria-hidden />
      ) : delta.direction === 'down' ? (
        <CaretDown size={10} aria-hidden />
      ) : null}
      <span aria-label={label}>
        {delta.direction === 'flat'
          ? '0'
          : `${delta.direction === 'up' ? '+' : '-'}${delta.amount}`}
      </span>
    </span>
  )
}

function StatTile({ tile }: { tile: OverviewTile }) {
  return (
    <Link
      to={tile.to}
      className="flex h-full min-w-0 flex-col gap-2 rounded-lg bg-surface p-5 transition-colors hover:bg-fill focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="text-meta text-muted">{tile.title}</span>
      <span className="flex items-baseline gap-2">
        <span className="text-section text-ink">{tile.value}</span>
        {tile.caption ? (
          <span className="text-caption text-subtle">{tile.caption}</span>
        ) : null}
      </span>
      {tile.trend ? (
        <>
          <span className="flex h-4 items-center">
            {tile.delta ? <DeltaMark delta={tile.delta} /> : null}
          </span>
          <span className="mt-auto block h-12">
            <Sparkline
              values={tile.trend.values}
              colour={tile.trend.colour}
              label={`${tile.title} per week, last ${tile.trend.values.length} weeks`}
            />
          </span>
        </>
      ) : tile.note ? (
        <span className="text-caption text-subtle">{tile.note}</span>
      ) : null}
    </Link>
  )
}

function StaffTiles({
  data,
  weeks,
}: {
  data: StaffOverviewResponse
  weeks: StaffUsageWeek[] | undefined
}) {
  const { trends, figures } = overviewTiles(data, weeks)
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 @pane:grid-cols-2">
        {trends.map((tile) => (
          <StatTile key={tile.title} tile={tile} />
        ))}
      </div>
      <div className="grid gap-4 @pane:grid-cols-3">
        {figures.map((tile) => (
          <StatTile key={tile.title} tile={tile} />
        ))}
      </div>
    </div>
  )
}

function StaffOverview() {
  const overview = useQuery(staffOverviewQueryOptions())
  const usage = useQuery(staffUsageQueryOptions(SPARKLINE_WEEKS))
  return (
    <PageScaffold
      title="Overview"
      description="The state of the service at a glance. Each figure opens the screen behind it."
    >
      {overview.isPending ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 @pane:grid-cols-2">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
          <div className="grid gap-4 @pane:grid-cols-3">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      ) : overview.isError ? (
        <ErrorNotice message="Could not load the overview." />
      ) : (
        <StaffTiles
          data={overview.data}
          weeks={usage.data?.weeks?.slice(-SPARKLINE_WEEKS)}
        />
      )}
    </PageScaffold>
  )
}
