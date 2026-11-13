import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@obiter/ui'
import { useCurrentUser } from '../current-user'
import { PageScaffold } from '../page-scaffold'
import { SegmentedControl } from '../segmented-control'
import { ShellNotFound } from '../shell-states'
import { staffUsageQueryOptions, staffUsageWeeks } from '../staff'
import { ErrorNotice } from './settings-fields'
import { WeeklyActivityChart } from './staff-usage-charts'
import {
  OrganisationsTable,
  RetentionTable,
  WeeklyCountsTable,
} from './staff-usage-tables'

const WEEK_OPTIONS = [
  { value: '4', label: '4 weeks' },
  { value: '12', label: '12 weeks' },
  { value: '26', label: '26 weeks' },
  { value: '52', label: '52 weeks' },
] as const

export function StaffUsageRouteView() {
  const { data: me } = useCurrentUser()
  if (!me.isStaff) return <ShellNotFound />
  return <StaffUsage />
}

function StaffUsage() {
  const navigate = useNavigate()
  const searchStr = useRouterState({
    select: (state) => state.location.searchStr,
  })
  const weeks = staffUsageWeeks(
    Object.fromEntries(new URLSearchParams(searchStr)),
  )
  const usage = useQuery(staffUsageQueryOptions(weeks))
  return (
    <PageScaffold
      title="Usage"
      description="Aggregates only, counted from records the product already keeps. The Obiter staff organisation is excluded."
      actions={
        <SegmentedControl<string>
          label="Weeks shown"
          value={String(weeks)}
          options={[...WEEK_OPTIONS]}
          onChange={(value) =>
            void navigate({
              to: '/staff/usage',
              search: { weeks: Number(value) },
            })
          }
        />
      }
    >
      {usage.isPending ? (
        <div className="flex flex-col gap-6">
          <Skeleton className="h-44" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : usage.isError ? (
        <ErrorNotice message="Could not load usage." />
      ) : (
        <div className="flex flex-col gap-10">
          <section aria-label="Weekly activity" className="flex flex-col gap-4">
            <WeeklyActivityChart weeks={usage.data.weeks} />
          </section>
          <section aria-label="Weekly counts" className="flex flex-col gap-4">
            <h2 className="text-item text-ink">Every feature, per week</h2>
            <WeeklyCountsTable weeks={usage.data.weeks} />
          </section>
          <section
            aria-label="Usage by organisation"
            className="flex flex-col gap-4"
          >
            <h2 className="text-item text-ink">By organisation</h2>
            <OrganisationsTable organisations={usage.data.organisations} />
          </section>
          <section aria-label="Retention" className="flex flex-col gap-4">
            <h2 className="text-item text-ink">Retention by signup week</h2>
            <RetentionTable retention={usage.data.retention} />
          </section>
        </div>
      )}
    </PageScaffold>
  )
}
