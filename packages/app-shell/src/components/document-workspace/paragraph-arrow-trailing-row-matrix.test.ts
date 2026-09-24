import { describe, expect, it } from 'bun:test'
import { wrapLines, type WrappedLine } from '../../document-page-flow'
import {
  offsetAfterArrow,
  offsetVertically,
  type ArrowNeighbor,
} from './paragraph-arrow'

/**
 * The caret model must place one row per hard-break segment and one empty row
 * after a trailing break, because that is what the browser textarea renders.
 * `text.split('\n')` is the browser's own row list, and the caret at
 * `text.length` sits on the empty row that trailing break opens.
 */

const FONT = 16
// A width no line can reach: each hard-break segment is exactly one row.
const NO_WRAP = 10_000_000

const rowsOf = (text: string, widthPx = NO_WRAP): WrappedLine[] =>
  wrapLines(text, FONT, widthPx)

/**
 * The last offset a row owns. A soft wrap shares its boundary with the row
 * below, so the boundary offset belongs to that row and this one ends one code
 * unit earlier; a hard break or the final row owns its end outright.
 */
function ownedEnd(lines: WrappedLine[], index: number): number {
  const line = lines[index]!
  const next = lines[index + 1]
  return next && next.from === line.to ? line.to - 1 : line.to
}

function neighbor(id: string, text: string, widthPx = NO_WRAP): ArrowNeighbor {
  return { id, text, lines: rowsOf(text, widthPx) }
}

function spanOf(line: WrappedLine): string {
  return `[${line.from}, ${line.to})`
}

describe('trailing-row property matrix', () => {
  const SEGMENTS = ['', 'alpha', 'alpha bravo charlie']
  const WIDTHS = [1, 40, 90, NO_WRAP]

  function texts(): string[] {
    const out: string[] = []
    for (let count = 1; count <= 3; count += 1) {
      const walk = (prefix: string[], depth: number) => {
        if (depth === 0) {
          for (let trailing = 0; trailing <= 3; trailing += 1) {
            out.push(`${prefix.join('\n')}${'\n'.repeat(trailing)}`)
          }
          return
        }
        for (const segment of SEGMENTS) walk([...prefix, segment], depth - 1)
      }
      walk([], count)
    }
    return out
  }

  it('keeps every row inside the text and every newline owned once', () => {
    for (const text of texts()) {
      for (const width of WIDTHS) {
        const lines = rowsOf(text, width)
        expect(lines.length).toBeGreaterThan(0)
        expect(lines[0]?.from).toBe(0)
        expect(lines[lines.length - 1]?.to).toBe(text.length)
        const terminators = new Map<number, number>()
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]!
          expect(line.from).toBeGreaterThanOrEqual(0)
          expect(line.to).toBeGreaterThanOrEqual(line.from)
          expect(line.to).toBeLessThanOrEqual(text.length)
          expect(line.text).toBe(text.slice(line.from, line.to))
          if (line.to < text.length) {
            terminators.set(line.to, (terminators.get(line.to) ?? 0) + 1)
          }
          const next = lines[index + 1]
          if (!next) continue
          const gap = next.from - line.to
          expect([0, 1]).toContain(gap)
          if (gap === 1) expect(text[line.to]).toBe('\n')
        }
        for (let index = 0; index < text.length; index += 1) {
          if (text[index] !== '\n') continue
          expect(terminators.get(index)).toBe(1)
        }
      }
    }
  })

  it('moves one adjacent row at a time and never off the ends', () => {
    for (const text of texts()) {
      for (const width of WIDTHS) {
        const lines = rowsOf(text, width)
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]!
          const previous = lines[index - 1]
          const next = lines[index + 1]
          const offset = ownedEnd(lines, index)
          const column = offset - line.from
          const down = offsetVertically({
            key: 'ArrowDown',
            offset,
            lines,
            column,
          })
          const up = offsetVertically({ key: 'ArrowUp', offset, lines, column })
          if (next) {
            expect(
              down != null && down >= next.from && down <= next.to,
              `down from row ${index} ${spanOf(line)} left row ${spanOf(next)}`,
            ).toBe(true)
          } else {
            expect(down).toBeUndefined()
          }
          if (previous) {
            expect(
              up != null && up >= previous.from && up <= previous.to,
              `up from row ${index} ${spanOf(line)} left row ${spanOf(previous)}`,
            ).toBe(true)
          } else {
            expect(up).toBeUndefined()
          }
          for (const moved of [down, up]) {
            if (moved == null) continue
            expect(moved).toBeGreaterThanOrEqual(0)
            expect(moved).toBeLessThanOrEqual(text.length)
          }
        }
      }
    }
  })

  it('recovers the desired column between adjacent rows that are wide enough', () => {
    for (const text of texts()) {
      for (const width of WIDTHS) {
        const lines = rowsOf(text, width)
        for (let index = 0; index < lines.length - 1; index += 1) {
          const line = lines[index]!
          const next = lines[index + 1]!
          const following = lines[index + 2]
          const soft = next.from === line.to
          const lineWidth = line.to - line.from
          const nextWidth = next.to - next.from
          // Stay strictly inside a soft-wrapped row on both sides: its end is
          // owned by the row below.
          const maxColumn = Math.min(
            soft ? lineWidth - 1 : lineWidth,
            following && following.from === next.to ? nextWidth - 1 : nextWidth,
          )
          for (const column of new Set([0, 1, maxColumn])) {
            if (column > maxColumn || column < 0) continue
            const down = offsetVertically({
              key: 'ArrowDown',
              offset: line.from + column,
              lines,
              column,
            })
            expect(down).toBe(next.from + column)
            const up = offsetVertically({
              key: 'ArrowUp',
              offset: down!,
              lines,
              column,
            })
            expect(up).toBe(line.from + column)
          }
        }
      }
    }
  })

  it('leaves the paragraph only after the trailing row', () => {
    const next = neighbor('below', 'beta')
    for (const text of texts()) {
      if (!text.endsWith('\n')) continue
      for (const width of WIDTHS) {
        const lines = rowsOf(text, width)
        expect(lines[lines.length - 1]?.from).toBe(text.length)
        // Every row except the last stays inside the paragraph.
        for (let index = 0; index < lines.length - 1; index += 1) {
          const line = lines[index]!
          const offset = ownedEnd(lines, index)
          expect(
            offsetAfterArrow({
              key: 'ArrowDown',
              offset,
              text,
              lines,
              column: offset - line.from,
              next,
            }),
          ).toBeUndefined()
        }
        expect(
          offsetAfterArrow({
            key: 'ArrowDown',
            offset: text.length,
            text,
            lines,
            column: 0,
            next,
          }),
        ).toEqual({ paragraphId: 'below', offset: 0 })
      }
    }
  })
})
