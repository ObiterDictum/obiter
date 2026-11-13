import type { StaffUsageWeek } from '@obiter/contracts'
import { formatDate } from '../format'

const WIDTH = 640
const HEIGHT = 240
const LEFT = 44
const RIGHT = 16
const TOP = 16
const BOTTOM = 30
const PLOT_WIDTH = WIDTH - LEFT - RIGHT
const PLOT_HEIGHT = HEIGHT - TOP - BOTTOM
const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

function xAt(index: number, count: number) {
  return LEFT + (index / (count - 1)) * PLOT_WIDTH
}

function yAt(value: number, max: number) {
  return TOP + PLOT_HEIGHT * (1 - value / max)
}

function points(
  weeks: StaffUsageWeek[],
  pick: (week: StaffUsageWeek) => number,
  max: number,
): string {
  return weeks
    .map(
      (week, index) =>
        `${xAt(index, weeks.length).toFixed(2)},${yAt(pick(week), max).toFixed(2)}`,
    )
    .join(' ')
}

function shortWeek(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

export function WeeklyActivityChart({ weeks }: { weeks: StaffUsageWeek[] }) {
  const max = Math.max(
    1,
    ...weeks.map((week) => Math.max(week.activeUsers, week.newAccounts)),
  )
  const series = [
    {
      label: 'Active users',
      pick: (week: StaffUsageWeek) => week.activeUsers,
      colour: 'var(--obiter-brand)',
      dashed: false,
    },
    {
      label: 'New accounts',
      pick: (week: StaffUsageWeek) => week.newAccounts,
      colour: 'var(--obiter-status-success)',
      dashed: true,
    },
  ]
  const xLabels = [
    ...new Set([0, Math.floor((weeks.length - 1) / 2), weeks.length - 1]),
  ]
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="text-item text-ink">
        Active users and new accounts per week
      </figcaption>
      {weeks.length > 1 ? (
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label="Line chart of active users and new accounts per week"
          className="h-auto w-full"
        >
          {GRID_FRACTIONS.map((fraction) => {
            const y = TOP + PLOT_HEIGHT * (1 - fraction)
            return (
              <g key={fraction}>
                <line
                  x1={LEFT}
                  x2={WIDTH - RIGHT}
                  y1={y}
                  y2={y}
                  className="stroke-line"
                  strokeWidth="1"
                />
                {fraction === 0 || fraction === 1 ? (
                  <text
                    x={LEFT - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-subtle text-caption"
                  >
                    {fraction === 0 ? '0' : max}
                  </text>
                ) : null}
              </g>
            )
          })}
          {xLabels.map((index) => {
            const last = index === weeks.length - 1
            return (
              <text
                key={index}
                x={xAt(index, weeks.length)}
                y={HEIGHT - 8}
                textAnchor={index === 0 ? 'start' : last ? 'end' : 'middle'}
                className="fill-subtle text-caption"
              >
                {shortWeek(weeks[index].weekStart)}
              </text>
            )
          })}
          {series.map((item) => (
            <polyline
              key={item.label}
              points={points(weeks, item.pick, max)}
              fill="none"
              stroke={item.colour}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={item.dashed ? '6 4' : undefined}
            />
          ))}
        </svg>
      ) : (
        <p className="text-meta text-muted">
          Not enough weeks to draw a chart.
        </p>
      )}
      <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-hidden>
        {series.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-4 border-t-2"
              style={{
                borderColor: item.colour,
                borderStyle: item.dashed ? 'dashed' : 'solid',
              }}
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
