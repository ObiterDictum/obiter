import type { StaffUsageOrganisation, StaffUsageWeek } from '@obiter/contracts'

export const SERIES_COLOURS = [
  'var(--obiter-reviewer-1)',
  'var(--obiter-reviewer-4)',
] as const

export const CHART_SURFACE = 'var(--obiter-canvas)'

export interface LineSeries {
  key: string
  label: string
  colour: string
  dashed?: boolean
  values: number[]
}

const FEATURE_KEYS = [
  ['documentsOpened', 'Docs opened'],
  ['documentsSaved', 'Docs saved'],
  ['mattersCreated', 'Matters'],
  ['redactionRuns', 'Redact'],
  ['verificationRuns', 'Verify'],
  ['agentRuns', 'Agent'],
  ['sourcesSaved', 'Sources'],
] as const

export type FeatureKey = (typeof FEATURE_KEYS)[number][0]

export function featureSeries(weeks: StaffUsageWeek[]): LineSeries[] {
  return FEATURE_KEYS.map(([key, label]) => ({
    key,
    label,
    colour: SERIES_COLOURS[0],
    values: weeks.map((week) => week[key]),
  }))
}

export function weeklySeries(weeks: StaffUsageWeek[]): LineSeries[] {
  return [
    {
      key: 'activeUsers',
      label: 'Active users',
      colour: SERIES_COLOURS[0],
      values: weeks.map((week) => week.activeUsers),
    },
    {
      key: 'newAccounts',
      label: 'New accounts',
      colour: SERIES_COLOURS[1],
      dashed: true,
      values: weeks.map((week) => week.newAccounts),
    },
  ]
}

export interface ChartGeometry {
  width: number
  height: number
  left: number
  right: number
  top: number
  bottom: number
}

export const FULL_CHART: ChartGeometry = {
  width: 640,
  height: 240,
  left: 44,
  right: 16,
  top: 16,
  bottom: 30,
}

export const COMPACT_CHART: ChartGeometry = {
  width: 320,
  height: 104,
  left: 30,
  right: 8,
  top: 8,
  bottom: 20,
}

export function plotWidth(geometry: ChartGeometry): number {
  return geometry.width - geometry.left - geometry.right
}

export function plotHeight(geometry: ChartGeometry): number {
  return geometry.height - geometry.top - geometry.bottom
}

export function xAt(
  index: number,
  count: number,
  geometry: ChartGeometry,
): number {
  if (count <= 1) return geometry.left + plotWidth(geometry) / 2
  return geometry.left + (index / (count - 1)) * plotWidth(geometry)
}

export function yAt(
  value: number,
  max: number,
  geometry: ChartGeometry,
): number {
  const height = plotHeight(geometry)
  if (max <= 0) return geometry.top + height
  return geometry.top + height * (1 - value / max)
}

export function niceMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const multiple of [1, 2, 5, 10]) {
    const candidate = multiple * power
    if (value <= candidate) return candidate
  }
  return 10 * power
}

export function seriesMax(series: LineSeries[]): number {
  return niceMax(Math.max(0, ...series.flatMap((item) => item.values)))
}

export function linePoints(
  values: number[],
  max: number,
  geometry: ChartGeometry,
): string {
  return values
    .map(
      (value, index) =>
        `${xAt(index, values.length, geometry).toFixed(2)},${yAt(value, max, geometry).toFixed(2)}`,
    )
    .join(' ')
}

export function shortWeek(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
  }).format(date)
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value)
}

export function formatTick(value: number): string {
  if (value < 10_000) return formatCount(value)
  if (value < 10_000_000) {
    const k = value / 1000
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`
  }
  const m = value / 1_000_000
  return `${Number.isInteger(m) ? m : m.toFixed(1)}M`
}

export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
): { points: string; end: { x: number; y: number } } | null {
  if (values.length < 2) return null
  const padX = 3
  const padY = 4
  const innerWidth = width - padX * 2
  const innerHeight = height - padY * 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const x = (index: number) => padX + (index / (values.length - 1)) * innerWidth
  const y = (value: number) =>
    span === 0
      ? padY + innerHeight / 2
      : padY + innerHeight * (1 - (value - min) / span)
  return {
    points: values
      .map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`)
      .join(' '),
    end: { x: x(values.length - 1), y: y(values[values.length - 1]) },
  }
}

export function weekDelta(values: number[]): number | null {
  if (values.length < 2) return null
  return values[values.length - 1] - values[values.length - 2]
}

export type OrgMetricKey =
  'activeUsers' | 'documentsSaved' | 'mattersCreated' | 'verificationRuns'

export const ORG_METRICS: { key: OrgMetricKey; label: string }[] = [
  { key: 'activeUsers', label: 'Active users' },
  { key: 'documentsSaved', label: 'Docs saved' },
  { key: 'mattersCreated', label: 'Matters' },
  { key: 'verificationRuns', label: 'Verify runs' },
]

export interface OrgBar {
  id: string
  label: string
  value: number
  organisations: number
}

const ORG_BAR_LIMIT = 10

export function orgBars(
  organisations: StaffUsageOrganisation[],
  metric: OrgMetricKey,
): OrgBar[] {
  const sorted = [...organisations].sort(
    (a, b) => b[metric] - a[metric] || a.name.localeCompare(b.name),
  )
  const top = sorted.slice(0, ORG_BAR_LIMIT)
  const rest = sorted.slice(ORG_BAR_LIMIT)
  const bars: OrgBar[] = top.map((org) => ({
    id: org.organisationId,
    label: org.name,
    value: org[metric],
    organisations: 1,
  }))
  if (rest.length > 0) {
    bars.push({
      id: 'other',
      label: `Other (${rest.length} ${
        rest.length === 1 ? 'organisation' : 'organisations'
      })`,
      value: rest.reduce((sum, org) => sum + org[metric], 0),
      organisations: rest.length,
    })
  }
  return bars
}
