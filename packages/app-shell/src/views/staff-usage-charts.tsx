import type { StaffUsageWeek } from '@obiter/contracts'
import { formatDate } from '../format'
import { featureSeries, weeklySeries } from './staff-chart-data'
import { LineChart } from './staff-line-chart'

function WeeklyCountsTableView({ weeks }: { weeks: StaffUsageWeek[] }) {
  return (
    <table className="sr-only">
      <caption>Weekly active users and new accounts</caption>
      <thead>
        <tr>
          <th>Week</th>
          <th>Active users</th>
          <th>New accounts</th>
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week.weekStart}>
            <td>{formatDate(week.weekStart)}</td>
            <td>{week.activeUsers}</td>
            <td>{week.newAccounts}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WeeklyActivityChart({ weeks }: { weeks: StaffUsageWeek[] }) {
  return (
    <LineChart
      categories={weeks.map((week) => week.weekStart)}
      series={weeklySeries(weeks)}
      ariaLabel="Line chart of active users and new accounts per week"
      title="Active users and new accounts per week"
      table={<WeeklyCountsTableView weeks={weeks} />}
    />
  )
}

export function FeatureUseCharts({ weeks }: { weeks: StaffUsageWeek[] }) {
  const categories = weeks.map((week) => week.weekStart)
  return (
    <div className="grid grid-cols-1 gap-4 @pane:grid-cols-2 @pane-wide:grid-cols-3 @pane-full:grid-cols-4">
      {featureSeries(weeks).map((series) => (
        <LineChart
          key={series.key}
          variant="compact"
          categories={categories}
          series={[series]}
          ariaLabel={`${series.label} per week`}
          title={series.label}
          titleClassName="text-meta text-ink"
        />
      ))}
    </div>
  )
}
