import { describe, expect, it } from 'bun:test'
import type { StaffUsageOrganisation, StaffUsageWeek } from '@obiter/contracts'
import {
  COMPACT_CHART,
  FULL_CHART,
  featureSeries,
  formatTick,
  linePoints,
  niceMax,
  orgBars,
  seriesMax,
  sparklinePoints,
  weekDelta,
  weeklySeries,
  xAt,
  yAt,
} from './staff-chart-data'

function week(overrides: Partial<StaffUsageWeek>): StaffUsageWeek {
  return {
    weekStart: '2026-01-05',
    activeUsers: 0,
    newAccounts: 0,
    documentsOpened: 0,
    documentsSaved: 0,
    mattersCreated: 0,
    redactionRuns: 0,
    verificationRuns: 0,
    agentRuns: 0,
    sourcesSaved: 0,
    ...overrides,
  }
}

describe('weeklySeries', () => {
  it('aligns each series to the same week order', () => {
    const weeks = [
      week({ weekStart: '2026-01-05', activeUsers: 3, newAccounts: 1 }),
      week({ weekStart: '2026-01-12', activeUsers: 5, newAccounts: 2 }),
    ]
    const series = weeklySeries(weeks)
    expect(series.map((item) => item.key)).toEqual([
      'activeUsers',
      'newAccounts',
    ])
    expect(series[0].values).toEqual([3, 5])
    expect(series[1].values).toEqual([1, 2])
    expect(series[1].dashed).toBe(true)
    expect(series[0].colour).not.toBe(series[1].colour)
  })
})

describe('featureSeries', () => {
  it('builds one single-series chart per feature on the shared weeks', () => {
    const weeks = [
      week({ documentsOpened: 7, agentRuns: 2 }),
      week({ documentsOpened: 9, agentRuns: 4 }),
    ]
    const series = featureSeries(weeks)
    expect(series).toHaveLength(7)
    expect(series.map((item) => item.label)).toEqual([
      'Docs opened',
      'Docs saved',
      'Matters',
      'Redact',
      'Verify',
      'Agent',
      'Sources',
    ])
    const opened = series.find((item) => item.key === 'documentsOpened')
    const agent = series.find((item) => item.key === 'agentRuns')
    expect(opened?.values).toEqual([7, 9])
    expect(agent?.values).toEqual([2, 4])
    for (const item of series) {
      expect(item.values).toHaveLength(weeks.length)
      expect(item.colour).toBe(series[0].colour)
    }
  })
})

describe('niceMax and seriesMax', () => {
  it('rounds the axis maximum up to a clean number', () => {
    expect(niceMax(0)).toBe(1)
    expect(niceMax(7)).toBe(10)
    expect(niceMax(10)).toBe(10)
    expect(niceMax(11)).toBe(20)
    expect(niceMax(240)).toBe(500)
    expect(niceMax(1200)).toBe(2000)
  })

  it('takes the largest value across every series', () => {
    const max = seriesMax(weeklySeries([week({ activeUsers: 30 })]))
    expect(max).toBe(50)
  })
})

describe('linePoints', () => {
  it('places the first point on the left edge and the last on the right', () => {
    const points = linePoints([0, 10], 10, FULL_CHART).split(' ')
    const first = points[0].split(',').map(Number)
    const last = points[1].split(',').map(Number)
    expect(first[0]).toBeCloseTo(FULL_CHART.left)
    expect(last[0]).toBeCloseTo(FULL_CHART.width - FULL_CHART.right)
    expect(first[1]).toBeCloseTo(FULL_CHART.top + 194)
    expect(last[1]).toBeCloseTo(FULL_CHART.top)
  })

  it('centres a single category instead of dividing by zero', () => {
    expect(xAt(0, 1, COMPACT_CHART)).toBeCloseTo(
      COMPACT_CHART.left +
        (COMPACT_CHART.width - COMPACT_CHART.left - COMPACT_CHART.right) / 2,
    )
    expect(yAt(0, 0, FULL_CHART)).toBeCloseTo(FULL_CHART.top + 194)
  })
})

describe('formatTick', () => {
  it('writes axis ticks in full under ten thousand and compact above', () => {
    expect(formatTick(0)).toBe('0')
    expect(formatTick(999)).toBe('999')
    expect(formatTick(2400)).toBe('2,400')
    expect(formatTick(12000)).toBe('12K')
    expect(formatTick(12500)).toBe('12.5K')
  })
})

describe('sparklinePoints', () => {
  it('normalises values into the drawing area and marks the last point', () => {
    const geometry = sparklinePoints([0, 10], 120, 36)
    expect(geometry).not.toBeNull()
    expect(geometry?.points.split(' ')).toHaveLength(2)
    expect(geometry?.end.x).toBeCloseTo(117)
    expect(geometry?.end.y).toBeCloseTo(4)
  })

  it('draws a flat midline when every value is identical', () => {
    const geometry = sparklinePoints([4, 4, 4], 120, 36)
    expect(geometry?.end.y).toBeCloseTo(18)
  })

  it('returns nothing for fewer than two points', () => {
    expect(sparklinePoints([3], 120, 36)).toBeNull()
    expect(sparklinePoints([], 120, 36)).toBeNull()
  })
})

describe('weekDelta', () => {
  it('measures the last week against the one before it', () => {
    expect(weekDelta([1, 4, 6])).toBe(2)
    expect(weekDelta([5, 2])).toBe(-3)
    expect(weekDelta([3])).toBeNull()
    expect(weekDelta([])).toBeNull()
  })
})

function organisation(
  overrides: Partial<StaffUsageOrganisation> & { name: string },
): StaffUsageOrganisation {
  return {
    organisationId: `org_${overrides.name}`,
    memberCount: 0,
    activeUsers: 0,
    newAccounts: 0,
    documentsOpened: 0,
    documentsSaved: 0,
    mattersCreated: 0,
    redactionRuns: 0,
    verificationRuns: 0,
    agentRuns: 0,
    sourcesSaved: 0,
    ...overrides,
  }
}

describe('orgBars', () => {
  it('sorts organisations by the chosen metric, largest first', () => {
    const bars = orgBars(
      [
        organisation({ name: 'Beta', activeUsers: 2, documentsSaved: 9 }),
        organisation({ name: 'Alpha', activeUsers: 8, documentsSaved: 1 }),
      ],
      'activeUsers',
    )
    expect(bars.map((bar) => bar.label)).toEqual(['Alpha', 'Beta'])
    const saved = orgBars(
      [
        organisation({ name: 'Beta', activeUsers: 2, documentsSaved: 9 }),
        organisation({ name: 'Alpha', activeUsers: 8, documentsSaved: 1 }),
      ],
      'documentsSaved',
    )
    expect(saved.map((bar) => bar.label)).toEqual(['Beta', 'Alpha'])
  })

  it('folds organisations past the tenth into a single Other bar', () => {
    const orgs = Array.from({ length: 13 }, (_, index) =>
      organisation({
        name: `Org ${String(index).padStart(2, '0')}`,
        organisationId: `org_${index}`,
        activeUsers: 13 - index,
      }),
    )
    const bars = orgBars(orgs, 'activeUsers')
    expect(bars).toHaveLength(11)
    expect(bars[9].label).toBe('Org 09')
    const other = bars[10]
    expect(other.label).toBe('Other (3 organisations)')
    expect(other.value).toBe(3 + 2 + 1)
    expect(other.organisations).toBe(3)
  })

  it('keeps every organisation when ten or fewer qualify', () => {
    const bars = orgBars(
      [organisation({ name: 'Solo', activeUsers: 3 })],
      'activeUsers',
    )
    expect(bars).toHaveLength(1)
    expect(bars[0].organisations).toBe(1)
  })
})
