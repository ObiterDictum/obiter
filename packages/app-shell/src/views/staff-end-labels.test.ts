import { describe, expect, it } from 'bun:test'
import { FULL_CHART, type LineSeries } from './staff-chart-data'
import { END_LABEL_OFFSET, endLabelInset, endMarks } from './staff-end-labels'

function series(label: string, last: number): LineSeries {
  return {
    key: label,
    label,
    colour: 'var(--obiter-chart-1)',
    values: [last],
  }
}

describe('endLabelInset', () => {
  it('sizes the right gutter to the longest series label', () => {
    const inset = endLabelInset([
      series('Active users', 10),
      series('New accounts', 4),
    ])
    expect(inset).not.toBeNull()
    expect(inset).toBeGreaterThan('Active users'.length * 7)
    expect(endLabelInset([series('Solo', 3)])).toBeNull()
  })
})

describe('endMarks', () => {
  it('places each label just right of the line end, centred on the point', () => {
    const marks = endMarks(
      [series('Active users', 12), series('New accounts', 8)],
      20,
      1,
      FULL_CHART,
    )
    const plotRight = FULL_CHART.width - FULL_CHART.right
    for (const mark of marks) {
      expect(mark.labelX).toBe(plotRight + END_LABEL_OFFSET)
      expect(mark.labelY).toBeCloseTo(mark.y)
    }
  })

  it('keeps label centres at least 14px apart when points collide', () => {
    const marks = endMarks(
      [series('Active users', 10), series('New accounts', 10.4)],
      20,
      1,
      FULL_CHART,
    )
    const ys = marks.map((mark) => mark.labelY).sort((a, b) => a - b)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(14)
  })

  it('keeps nudged labels inside the plot area', () => {
    const marks = endMarks(
      [series('Active users', 20), series('New accounts', 19.5)],
      20,
      1,
      FULL_CHART,
    )
    const ceiling = FULL_CHART.top + 194 - 8
    for (const mark of marks) {
      expect(mark.labelY).toBeLessThanOrEqual(ceiling)
      expect(mark.labelY).toBeGreaterThanOrEqual(FULL_CHART.top + 8)
    }
    const ys = marks.map((mark) => mark.labelY).sort((a, b) => a - b)
    expect(ys[1] - ys[0]).toBeGreaterThanOrEqual(14)
  })
})
