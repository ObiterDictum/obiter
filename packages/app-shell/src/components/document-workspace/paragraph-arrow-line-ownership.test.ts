import { describe, expect, it } from 'bun:test'
import { wrapLines, type WrappedLine } from '../../document-page-flow'
import {
  createVerticalCaretColumn,
  offsetAfterArrow,
  offsetVertically,
  retainVerticalColumn,
  visualColumn,
  type VerticalCaretColumn,
} from './paragraph-arrow'

const NO_WRAP = 10_000_000
const FONT = 16

const spans = (...ranges: Array<[number, number]>): WrappedLine[] =>
  ranges.map(([from, to]) => ({ text: 'x'.repeat(to - from), from, to }))

function verticalMove(input: {
  state: VerticalCaretColumn
  lines: WrappedLine[]
  offset: number
  key: 'ArrowUp' | 'ArrowDown'
}): number | undefined {
  const column = retainVerticalColumn(input.state, input.lines, input.offset)
  return offsetVertically({
    key: input.key,
    offset: input.offset,
    lines: input.lines,
    column,
  })
}

function lineWidth(line: WrappedLine): number {
  return line.to - line.from
}

function requireLine(line: WrappedLine | undefined): WrappedLine {
  if (!line) throw new Error('expected a visual line')
  return line
}

describe('hard-break line ownership', () => {
  const text = `tiny\n${'a'.repeat(80)}\n${'b'.repeat(14)}`
  const hard = () => wrapLines(text, FONT, NO_WRAP)

  it('reports the sequence: up to the short hard-break line, then down to the long one', () => {
    const lines = hard()
    expect(lines).toEqual([
      { text: 'tiny', from: 0, to: 4 },
      { text: 'a'.repeat(80), from: 5, to: 85 },
      { text: 'b'.repeat(14), from: 86, to: 100 },
    ])
    const state = createVerticalCaretColumn()
    const up = verticalMove({ state, lines, offset: 45, key: 'ArrowUp' })
    expect(up).toBe(4)
    const down = verticalMove({ state, lines, offset: up!, key: 'ArrowDown' })
    expect(down).toBe(45)
  })

  it('reverse: down into a short hard-break line, then up back to the long line', () => {
    const reverse = wrapLines(
      `${'a'.repeat(80)}\ntiny\n${'b'.repeat(14)}`,
      FONT,
      NO_WRAP,
    )
    expect(reverse).toEqual([
      { text: 'a'.repeat(80), from: 0, to: 80 },
      { text: 'tiny', from: 81, to: 85 },
      { text: 'b'.repeat(14), from: 86, to: 100 },
    ])
    const state = createVerticalCaretColumn()
    const down = verticalMove({
      state,
      lines: reverse,
      offset: 40,
      key: 'ArrowDown',
    })
    expect(down).toBe(85)
    const up = verticalMove({
      state,
      lines: reverse,
      offset: down!,
      key: 'ArrowUp',
    })
    expect(up).toBe(40)
  })

  it('owns the newline code unit with the line it terminates', () => {
    const lines = hard()
    expect(visualColumn(lines, 4)).toBe(4)
    expect(visualColumn(lines, 5)).toBe(0)
    expect(visualColumn(lines, 85)).toBe(80)
    expect(visualColumn(lines, 86)).toBe(0)
  })

  it('moves from a newline-adjacent caret to the immediately adjacent line', () => {
    const lines = hard()
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 4, lines, column: 4 }),
    ).toBe(9)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 5, lines, column: 0 }),
    ).toBe(0)
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 85, lines, column: 80 }),
    ).toBe(100)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 86, lines, column: 0 }),
    ).toBe(5)
  })

  it('gives an empty visual line to a consecutive hard break', () => {
    const lines = wrapLines('a\n\nb', FONT, NO_WRAP)
    expect(lines).toEqual([
      { text: 'a', from: 0, to: 1 },
      { text: '', from: 2, to: 2 },
      { text: 'b', from: 3, to: 4 },
    ])
    expect(visualColumn(lines, 1)).toBe(1)
    expect(visualColumn(lines, 2)).toBe(0)
    expect(visualColumn(lines, 3)).toBe(0)
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 1, lines, column: 1 }),
    ).toBe(2)
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 2, lines, column: 0 }),
    ).toBe(3)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 3, lines, column: 0 }),
    ).toBe(2)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 2, lines, column: 0 }),
    ).toBe(0)
  })

  it('treats a CRLF hard break like LF for the line after the newline', () => {
    const lines = wrapLines('ab\r\ncd', FONT, NO_WRAP)
    expect(lines).toEqual([
      { text: 'ab\r', from: 0, to: 3 },
      { text: 'cd', from: 4, to: 6 },
    ])
    expect(visualColumn(lines, 3)).toBe(3)
    expect(visualColumn(lines, 4)).toBe(0)
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 3, lines, column: 3 }),
    ).toBe(6)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 4, lines, column: 0 }),
    ).toBe(0)
  })

  it('owns the newline slot at a hard break and starts the next line after it', () => {
    const lines = wrapLines('aa\nbb', FONT, NO_WRAP)
    expect(lines).toEqual([
      { text: 'aa', from: 0, to: 2 },
      { text: 'bb', from: 3, to: 5 },
    ])
    expect(visualColumn(lines, 2)).toBe(2)
    expect(visualColumn(lines, 3)).toBe(0)
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 2, lines, column: 2 }),
    ).toBe(5)
  })

  it('has no line above the first or below the final visual line', () => {
    const lines = hard()
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 0, lines, column: 0 }),
    ).toBeUndefined()
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 2, lines, column: 2 }),
    ).toBeUndefined()
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 99, lines, column: 13 }),
    ).toBeUndefined()
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 100, lines, column: 0 }),
    ).toBeUndefined()
    expect(visualColumn(lines, 100)).toBe(14)
  })

  it('keeps the shared soft-wrap boundary with the next line', () => {
    const wrapped = spans([0, 20], [20, 40])
    expect(visualColumn(wrapped, 19)).toBe(19)
    expect(visualColumn(wrapped, 20)).toBe(0)
    expect(
      offsetVertically({
        key: 'ArrowDown',
        offset: 19,
        lines: wrapped,
        column: 19,
      }),
    ).toBe(39)
    expect(
      offsetVertically({
        key: 'ArrowUp',
        offset: 20,
        lines: wrapped,
        column: 0,
      }),
    ).toBe(0)
  })

  it('keeps soft wraps sharing their boundary through the real projection', () => {
    const lines = wrapLines('alpha bravo charlie delta echo', FONT, 90)
    expect(lines.length).toBeGreaterThan(1)
    for (let index = 0; index < lines.length - 1; index += 1) {
      expect(requireLine(lines[index]).to).toBe(
        requireLine(lines[index + 1]).from,
      )
      expect(visualColumn(lines, requireLine(lines[index]).to)).toBe(0)
    }
  })

  it('crosses a paragraph boundary from a hard-break line without skipping a visual line', () => {
    const lines = hard()
    const above = { id: 'above', text: 'zzzz', lines: spans([0, 4]) }
    const below = { id: 'below', text: 'yyyy', lines: spans([0, 4]) }
    expect(
      offsetAfterArrow({
        key: 'ArrowUp',
        offset: 4,
        text,
        lines,
        column: 4,
        previous: above,
      }),
    ).toEqual({ paragraphId: 'above', offset: 4 })
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 99,
        text,
        lines,
        column: 13,
        next: below,
      }),
    ).toEqual({ paragraphId: 'below', offset: 4 })
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 45,
        text,
        lines,
        column: 40,
        next: below,
      }),
    ).toBeUndefined()
  })

  it('recovers the desired column across repeated up/down round trips', () => {
    const lines = hard()
    const state = createVerticalCaretColumn()
    let offset = 45
    for (let pass = 0; pass < 5; pass += 1) {
      const up = verticalMove({ state, lines, offset, key: 'ArrowUp' })
      expect(up).toBe(4)
      const down = verticalMove({ state, lines, offset: up!, key: 'ArrowDown' })
      expect(down).toBe(45)
      offset = down!
    }
  })

  it('recovers the desired column across repeated down/up round trips', () => {
    const lines = wrapLines(
      `${'a'.repeat(80)}\ntiny\n${'b'.repeat(14)}`,
      FONT,
      NO_WRAP,
    )
    const state = createVerticalCaretColumn()
    let offset = 40
    for (let pass = 0; pass < 5; pass += 1) {
      const down = verticalMove({ state, lines, offset, key: 'ArrowDown' })
      expect(down).toBe(85)
      const up = verticalMove({ state, lines, offset: down!, key: 'ArrowUp' })
      expect(up).toBe(40)
      offset = up!
    }
  })
})

describe('generated line-ownership matrix', () => {
  const LENGTHS = [0, 1, 4, 40] as const

  function hardBreakTexts(): string[] {
    const texts: string[] = []
    for (let count = 1; count <= 3; count += 1) {
      const walk = (prefix: string[], depth: number) => {
        if (depth === 0) {
          texts.push(prefix.join('\n'))
          return
        }
        for (const length of LENGTHS) {
          walk([...prefix, 'x'.repeat(length)], depth - 1)
        }
      }
      walk([], count)
    }
    return texts
  }

  const sampleOffsets = (line: WrappedLine): number[] => {
    const points = new Set<number>([line.from, line.to])
    if (line.to > line.from) {
      points.add(line.to - 1)
      points.add(line.from + Math.floor(lineWidth(line) / 2))
    }
    return [...points]
  }

  it('never moves more than one visual line and never skips one', () => {
    for (const text of hardBreakTexts()) {
      const lines = wrapLines(text, FONT, NO_WRAP)
      for (let index = 0; index < lines.length; index += 1) {
        const line = requireLine(lines[index])
        const previous = lines[index - 1]
        const next = lines[index + 1]
        for (const offset of sampleOffsets(line)) {
          const column = offset - line.from
          if (next) {
            const down = offsetVertically({
              key: 'ArrowDown',
              offset,
              lines,
              column,
            })
            expect(down).toBeDefined()
            expect(down!).toBeGreaterThanOrEqual(next.from)
            expect(down!).toBeLessThanOrEqual(next.to)
            expect(down!).toBeLessThanOrEqual(text.length)
          } else {
            expect(
              offsetVertically({ key: 'ArrowDown', offset, lines, column }),
            ).toBeUndefined()
          }
          if (previous) {
            const up = offsetVertically({
              key: 'ArrowUp',
              offset,
              lines,
              column,
            })
            expect(up).toBeDefined()
            expect(up!).toBeGreaterThanOrEqual(previous.from)
            expect(up!).toBeLessThanOrEqual(previous.to)
            expect(up!).toBeGreaterThanOrEqual(0)
          } else {
            expect(
              offsetVertically({ key: 'ArrowUp', offset, lines, column }),
            ).toBeUndefined()
          }
        }
      }
    }
  })

  it('recovers the desired column between adjacent lines when both are wide enough', () => {
    for (const text of hardBreakTexts()) {
      const lines = wrapLines(text, FONT, NO_WRAP)
      for (let index = 0; index < lines.length - 1; index += 1) {
        const line = requireLine(lines[index])
        const next = requireLine(lines[index + 1])
        for (const column of [0, 1, 4, 40]) {
          if (column > lineWidth(line) || column > lineWidth(next)) continue
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
  })

  it('follows the documented ownership rule at every boundary', () => {
    for (const text of hardBreakTexts()) {
      const lines = wrapLines(text, FONT, NO_WRAP)
      for (let index = 0; index < lines.length - 1; index += 1) {
        const line = requireLine(lines[index])
        const next = requireLine(lines[index + 1])
        expect(next.from).toBe(line.to + 1)
        expect(visualColumn(lines, line.to)).toBe(lineWidth(line))
        expect(visualColumn(lines, next.from)).toBe(0)
      }
    }
  })

  it('keeps soft-wrap boundaries shared across generated paragraphs', () => {
    const words = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    for (let length = 2; length <= words.length; length += 1) {
      const text = words.slice(0, length).join(' ')
      for (const width of [60, 90, 140]) {
        const lines = wrapLines(text, FONT, width)
        for (let index = 0; index < lines.length - 1; index += 1) {
          const line = requireLine(lines[index])
          const next = requireLine(lines[index + 1])
          const gap = next.from - line.to
          if (gap === 0) {
            expect(visualColumn(lines, line.to)).toBe(0)
          } else {
            expect(gap).toBe(1)
            expect(visualColumn(lines, line.to)).toBe(lineWidth(line))
            expect(visualColumn(lines, next.from)).toBe(0)
          }
        }
      }
    }
  })
})
