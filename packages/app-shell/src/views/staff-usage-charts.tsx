import type { StaffUsageWeek } from '@obiter/contracts'
import { formatDate } from '../format'

const WIDTH = 100
const HEIGHT = 100
const TOP = 8
const BOTTOM = 92

function points(
  weeks: StaffUsageWeek[],
  pick: (week: StaffUsageWeek) => number,
  max: number,
): string {
  return weeks
    .map((week, index) => {
      const x = (index / (weeks.length - 1)) * WIDTH
      const y = BOTTOM - (pick(week) / max) * (BOTTOM - TOP)
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

export function WeeklyActivityChart({ weeks }: { weeks: StaffUsageWeek[] }) {
  const max = Math.max(
    1,
    ...weeks.map((week) => Math.max(week.activeUsers, week.newAccounts)),
  )
  const series = [
    { label: 'Active users', pick: (week: StaffUsageWeek) => week.activeUsers },
    { label: 'New accounts', pick: (week: StaffUsageWeek) => week.newAccounts },
  ]
  const colours = ['var(--obiter-brand)', 'var(--obiter-status-info)']
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-item text-ink">
        Active users and new accounts per week
      </figcaption>
      {weeks.length > 1 ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Line chart of active users and new accounts per week"
          className="h-44 w-full"
        >
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1="0"
              x2={WIDTH}
              y1={TOP + (1 - ratio) * (BOTTOM - TOP)}
              y2={TOP + (1 - ratio) * (BOTTOM - TOP)}
              className="stroke-line"
              strokeWidth="0.3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {series.map((item, index) => (
            <polyline
              key={item.label}
              points={points(weeks, item.pick, max)}
              fill="none"
              stroke={colours[index]}
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : (
        <p className="text-meta text-muted">
          Not enough weeks to draw a chart.
        </p>
      )}
      <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-hidden>
        {series.map((item, index) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <span
              className="inline-block size-2 rounded-pill"
              style={{ backgroundColor: colours[index] }}
            />
            <span className="text-caption text-muted">{item.label}</span>
          </li>
        ))}
      </ul>
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
    </figure>
  )
}
