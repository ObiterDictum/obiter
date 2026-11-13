import {
  plotHeight,
  xAt,
  yAt,
  type ChartGeometry,
  type LineSeries,
} from './staff-chart-data'

export const END_LABEL_OFFSET = 8
const LABEL_GAP = 14
const LABEL_CHAR_WIDTH = 7
const LABEL_EDGE_PAD = 6
const LABEL_HALF_HEIGHT = 8

export interface EndMark {
  series: LineSeries
  x: number
  y: number
  labelX: number
  labelY: number
}

export function endLabelInset(series: LineSeries[]): number | null {
  if (series.length < 2) return null
  const widest = Math.max(...series.map((item) => item.label.length))
  return (
    Math.ceil(widest * LABEL_CHAR_WIDTH) + END_LABEL_OFFSET + LABEL_EDGE_PAD
  )
}

export function endMarks(
  series: LineSeries[],
  max: number,
  count: number,
  geometry: ChartGeometry,
): EndMark[] {
  const labelX = geometry.width - geometry.right + END_LABEL_OFFSET
  const marks = series.map((item) => ({
    series: item,
    x: xAt(count - 1, count, geometry),
    y: yAt(item.values[count - 1] ?? 0, max, geometry),
    labelX,
    labelY: 0,
  }))
  const ordered = [...marks].sort((a, b) => a.y - b.y)
  if (ordered.length === 0) return marks
  const floor = geometry.top + LABEL_HALF_HEIGHT
  const ceiling = geometry.top + plotHeight(geometry) - LABEL_HALF_HEIGHT
  const desired = ordered.map((mark) => mark.y)
  for (let index = 1; index < desired.length; index += 1) {
    const previous = desired[index - 1]
    const current = desired[index]
    if (previous !== undefined && current !== undefined) {
      desired[index] = Math.max(current, previous + LABEL_GAP)
    }
  }
  const last = desired[desired.length - 1]
  if (last !== undefined && last > ceiling) {
    const shift = last - ceiling
    for (let index = 0; index < desired.length; index += 1) {
      const value = desired[index]
      if (value !== undefined) desired[index] = value - shift
    }
  }
  const first = desired[0]
  if (first !== undefined && first < floor) {
    const shift = first - floor
    for (let index = 0; index < desired.length; index += 1) {
      const value = desired[index]
      if (value !== undefined) desired[index] = value - shift
    }
  }
  ordered.forEach((mark, index) => {
    const value = desired[index]
    mark.labelY = Math.min(Math.max(value ?? mark.y, floor), ceiling)
  })
  return marks
}
