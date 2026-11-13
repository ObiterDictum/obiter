import { useState, type PointerEvent, type ReactNode } from 'react'
import { formatDate } from '../format'
import { useElementWidth } from '../use-element-width'
import {
  CHART_SURFACE,
  COMPACT_CHART,
  FULL_CHART,
  formatCount,
  formatTick,
  linePoints,
  plotHeight,
  plotWidth,
  seriesMax,
  shortWeek,
  xAt,
  yAt,
  type ChartGeometry,
  type LineSeries,
} from './staff-chart-data'
import { endLabelInset, endMarks } from './staff-end-labels'

const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]
const COMPACT_GRID_FRACTIONS = [0, 0.5, 1]

export function LineChart({
  categories,
  series,
  ariaLabel,
  title,
  titleClassName = 'text-item text-ink',
  variant = 'full',
  formatValue = formatCount,
  table,
}: {
  categories: string[]
  series: LineSeries[]
  ariaLabel: string
  title?: string
  titleClassName?: string
  variant?: 'full' | 'compact'
  formatValue?: (value: number) => string
  table?: ReactNode
}) {
  const [hover, setHover] = useState<number | null>(null)
  const base = variant === 'compact' ? COMPACT_CHART : FULL_CHART
  const { ref, width: measuredWidth } = useElementWidth(base.width)
  const inset = series.length > 1 ? endLabelInset(series) : null
  const geometry: ChartGeometry = {
    ...base,
    width: measuredWidth,
    right: inset ?? base.right,
  }
  const { width, height, left, right, top } = geometry
  const plotW = plotWidth(geometry)
  const plotH = plotHeight(geometry)
  const count = categories.length
  const max = seriesMax(series)
  const fractions =
    variant === 'compact' ? COMPACT_GRID_FRACTIONS : GRID_FRACTIONS
  const xIndexes =
    variant === 'compact'
      ? [...new Set([0, count - 1])]
      : [...new Set([0, Math.floor((count - 1) / 2), count - 1])]
  const ends = series.length > 1 ? endMarks(series, max, count, geometry) : []
  const hoverX = hover === null ? null : xAt(hover, count, geometry)
  const tooltipLeft =
    hoverX === null
      ? 0
      : Math.min(
          variant === 'compact' ? 70 : 88,
          Math.max(variant === 'compact' ? 30 : 12, (hoverX / width) * 100),
        )

  const onPointerMove = (event: PointerEvent<SVGRectElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = (event.clientX - rect.left) / rect.width
    const plotRatio = (ratio * width - left) / plotW
    const index = Math.round(Math.min(1, Math.max(0, plotRatio)) * (count - 1))
    setHover(Number.isFinite(index) ? index : null)
  }

  return (
    <figure className="flex min-w-0 flex-col gap-3">
      {title ? (
        <figcaption className={titleClassName}>{title}</figcaption>
      ) : null}
      <div ref={ref} className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width}
          height={height}
          role="img"
          aria-label={ariaLabel}
          className="block"
        >
          {fractions.map((fraction) => {
            const y = top + plotH * (1 - fraction)
            return (
              <g key={fraction}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                  className="stroke-line"
                  strokeWidth="1"
                />
                {fraction === 0 || fraction === 1 ? (
                  <text
                    x={left - 8}
                    y={y}
                    textAnchor="end"
                    dominantBaseline="middle"
                    className="fill-subtle text-caption"
                  >
                    {fraction === 0 ? '0' : formatTick(max)}
                  </text>
                ) : null}
              </g>
            )
          })}
          {xIndexes.map((index) => {
            const last = index === count - 1
            return (
              <text
                key={index}
                x={xAt(index, count, geometry)}
                y={height - 6}
                textAnchor={index === 0 ? 'start' : last ? 'end' : 'middle'}
                className="fill-subtle text-caption"
              >
                {shortWeek(categories[index])}
              </text>
            )
          })}
          {series.map((item) => (
            <polyline
              key={item.key}
              points={linePoints(item.values, max, geometry)}
              fill="none"
              stroke={item.colour}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={item.dashed ? '6 4' : undefined}
            />
          ))}
          {hover !== null && hoverX !== null ? (
            <g>
              <line
                x1={hoverX}
                x2={hoverX}
                y1={top}
                y2={top + plotH}
                className="stroke-line"
                strokeWidth="1"
              />
              {series.map((item) => {
                const cy = yAt(item.values[hover] ?? 0, max, geometry)
                return (
                  <g key={item.key}>
                    <circle cx={hoverX} cy={cy} r="6" fill={CHART_SURFACE} />
                    <circle cx={hoverX} cy={cy} r="4" fill={item.colour} />
                  </g>
                )
              })}
            </g>
          ) : null}
          {ends.map((mark) => (
            <text
              key={mark.series.key}
              x={mark.labelX}
              y={mark.labelY}
              dominantBaseline="middle"
              className="fill-ink text-caption"
            >
              {mark.series.label}
            </text>
          ))}
          {count > 1 ? (
            <rect
              x={left}
              y={top}
              width={plotW}
              height={plotH}
              fill="transparent"
              className="cursor-crosshair"
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHover(null)}
            />
          ) : null}
        </svg>
        {hover !== null ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 z-10 w-max max-w-56 -translate-x-1/2 rounded-md border border-line bg-raised px-3 py-2 shadow-md"
            style={{ left: `${tooltipLeft}%` }}
          >
            <div className="text-caption text-subtle">
              {formatDate(categories[hover])}
            </div>
            {series.map((item) => (
              <div key={item.key} className="flex items-baseline gap-2">
                <span
                  aria-hidden
                  className="inline-block h-0 w-3 shrink-0 self-center border-t-2"
                  style={{
                    borderColor: item.colour,
                    borderStyle: item.dashed ? 'dashed' : 'solid',
                  }}
                />
                <span className="text-meta font-medium text-ink tabular-nums">
                  {formatValue(item.values[hover] ?? 0)}
                </span>
                <span className="text-caption text-muted">{item.label}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {series.length > 1 ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1" aria-hidden>
          {series.map((item) => (
            <li key={item.key} className="flex items-center gap-1.5">
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
      ) : null}
      {table}
    </figure>
  )
}
