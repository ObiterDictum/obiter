import { useState } from 'react'
import type { ErrorGroupList } from '@obiter/contracts'
import { formatDate } from '../format'
import { niceMax, shortWeek } from './staff-chart-data'
import { TableToggle } from './staff-usage-tables'

export function ErrorDailyChart({ daily }: { daily: ErrorGroupList['daily'] }) {
  const [table, setTable] = useState(false)
  const [active, setActive] = useState<number | null>(null)
  const max = niceMax(Math.max(0, ...daily.map((day) => day.count)))
  const width = 580 / Math.max(1, daily.length)
  const barWidth = Math.min(8, width * 0.6)
  const current = active === null ? null : daily[active]
  return (
    <section aria-label="Daily errors" className="flex flex-col gap-2">
      <svg
        role="img"
        aria-label="Daily error count"
        viewBox="0 0 640 200"
        className="max-h-52 w-full overflow-visible"
      >
        {[0, max].map((value) => (
          <g key={value}>
            <line
              x1="44"
              x2="624"
              y1={164 - (value / max) * 148}
              y2={164 - (value / max) * 148}
              stroke="var(--obiter-border)"
            />
            <text
              x="36"
              y={168 - (value / max) * 148}
              textAnchor="end"
              fontSize="11"
              fill="var(--obiter-text-muted)"
            >
              {value}
            </text>
          </g>
        ))}
        {daily.map((day, index) => {
          const x = 44 + width * (index + 0.5)
          const y = 164 - (day.count / max) * 148
          return (
            <g key={day.day}>
              <path
                d={`M ${x - barWidth / 2} 164 V ${Math.min(164, y + 4)} Q ${x - barWidth / 2} ${y} ${x} ${y} Q ${x + barWidth / 2} ${y} ${x + barWidth / 2} ${Math.min(164, y + 4)} V 164 Z`}
                fill="var(--obiter-chart-1)"
              />
              <rect
                x={x - width / 2}
                y="16"
                width={width}
                height="148"
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${formatDate(day.day)}: ${day.count} errors`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              >
                <title>
                  {formatDate(day.day)}: {day.count} errors
                </title>
              </rect>
              {[
                0,
                Math.floor((daily.length - 1) / 2),
                daily.length - 1,
              ].includes(index) ? (
                <text
                  x={x}
                  y="188"
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--obiter-text-muted)"
                >
                  {shortWeek(day.day)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
      <p role="status" className="min-h-5 text-caption text-muted">
        {current ? `${formatDate(current.day)}: ${current.count} errors` : ''}
      </p>
      <div>
        <TableToggle open={table} onToggle={() => setTable(!table)} />
      </div>
      {table ? (
        <div className="max-h-52 overflow-auto">
          <table
            aria-label="Daily error counts"
            className="w-full text-meta text-ink"
          >
            <thead>
              <tr>
                <th className="text-left">Date</th>
                <th className="text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((day) => (
                <tr key={day.day}>
                  <td>{formatDate(day.day)}</td>
                  <td className="text-right tabular-nums">{day.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
