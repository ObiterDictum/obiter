import { describe, expect, it } from 'vitest'
import { takeLine, wrapLines, type WrappedLine } from '../../document-page-flow'
import {
  createVerticalCaretColumn,
  offsetAfterArrow,
  offsetVertically,
  retainVerticalColumn,
  visualColumn,
  type ArrowNeighbor,
  type VerticalCaretColumn,
} from './paragraph-arrow'

/**
 * The caret model must place one row per hard-break segment and one empty row
 * after a trailing break, because that is what the browser textarea renders:
 * `text.split('\n')` is the browser's own row list, and the caret at
 * `text.length` sits on the empty row that trailing break opens.
 */

const FONT = 16
// A width no line can reach: each hard-break segment is exactly one row.
const NO_WRAP = 10_000_000

const rowsOf = (text: string, widthPx = NO_WRAP): WrappedLine[] =>
  wrapLines(text, FONT, widthPx)

/** The smallest width at which `text` fits on exactly one row. */
function exactWidth(text: string): number {
  let width = 1
  while (takeLine(text, 0, FONT, width) < text.length) width += 1
  return width
}

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

function neighbor(id: string, text: string, widthPx = NO_WRAP): ArrowNeighbor {
  return { id, text, lines: rowsOf(text, widthPx) }
}

describe('the trailing empty row', () => {
  it('owns the final caret offset and sits below the line it follows', () => {
    const lines = rowsOf('alpha\n')
    expect(lines).toEqual([
      { text: 'alpha', from: 0, to: 5 },
      { text: '', from: 6, to: 6 },
    ])
    // The caret at text.length renders on the empty row, column 0.
    expect(visualColumn(lines, 6)).toBe(0)
    // The newline slot at 5 stays the display end of 'alpha'.
    expect(visualColumn(lines, 5)).toBe(5)
    // Up from the trailing row reaches the row above: the caret there sits at
    // the retained column 0, which is that row's first code unit.
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 6, lines, column: 0 }),
    ).toBe(0)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 6, lines, column: 5 }),
    ).toBe(5)
    // Down from the hard-break slot reaches the empty row, not the paragraph
    // below it.
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 5, lines, column: 5 }),
    ).toBe(6)
  })

  it('keeps ArrowUp on the immediately preceding line', () => {
    const lines = rowsOf('alpha\n')
    const state = createVerticalCaretColumn()
    // Up from the trailing row lands on the line above, not past it.
    expect(verticalMove({ state, lines, offset: 6, key: 'ArrowUp' })).toBe(0)
    // Up again leaves the paragraph.
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 0, lines, column: 0 }),
    ).toBeUndefined()
  })

  it('represents both empty rows of a double trailing break', () => {
    const lines = rowsOf('alpha\n\n')
    expect(lines).toEqual([
      { text: 'alpha', from: 0, to: 5 },
      { text: '', from: 6, to: 6 },
      { text: '', from: 7, to: 7 },
    ])
    expect(visualColumn(lines, 6)).toBe(0)
    expect(visualColumn(lines, 7)).toBe(0)
    const state = createVerticalCaretColumn()
    let offset = 5
    for (const expected of [6, 7]) {
      offset = verticalMove({ state, lines, offset, key: 'ArrowDown' })!
      expect(offset).toBe(expected)
    }
    for (const expected of [6, 5]) {
      offset = verticalMove({ state, lines, offset, key: 'ArrowUp' })!
      expect(offset).toBe(expected)
    }
  })

  it('gives a break-only paragraph its initial and trailing rows', () => {
    const lines = rowsOf('\n')
    expect(lines).toEqual([
      { text: '', from: 0, to: 0 },
      { text: '', from: 1, to: 1 },
    ])
    const state = createVerticalCaretColumn()
    expect(verticalMove({ state, lines, offset: 0, key: 'ArrowDown' })).toBe(1)
    expect(verticalMove({ state, lines, offset: 1, key: 'ArrowUp' })).toBe(0)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 0, lines, column: 0 }),
    ).toBeUndefined()
  })

  it('gives three empty rows to two breaks', () => {
    expect(rowsOf('\n\n')).toEqual([
      { text: '', from: 0, to: 0 },
      { text: '', from: 1, to: 1 },
      { text: '', from: 2, to: 2 },
    ])
  })

  it('gives a single row to an empty paragraph', () => {
    const lines = rowsOf('')
    expect(lines).toEqual([{ text: '', from: 0, to: 0 }])
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 0, lines, column: 0 }),
    ).toBeUndefined()
  })

  it('adds no row without a trailing break', () => {
    const lines = rowsOf('alpha')
    expect(lines).toEqual([{ text: 'alpha', from: 0, to: 5 }])
    expect(visualColumn(lines, 5)).toBe(5)
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 5, lines, column: 5 }),
    ).toBeUndefined()
  })

  it('keeps the last soft-wrapped row as the final row', () => {
    const text = 'alpha bravo charlie delta echo'
    const lines = rowsOf(text, 90)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines[lines.length - 1]?.to).toBe(text.length)
    expect(
      offsetVertically({
        key: 'ArrowDown',
        offset: text.length,
        lines,
        column: visualColumn(lines, text.length),
      }),
    ).toBeUndefined()
  })

  it('adds the empty row after a soft-wrapped line that ends in a break', () => {
    const text = 'alpha bravo charlie delta echo\n'
    const lines = rowsOf(text, 90)
    const wrapped = rowsOf('alpha bravo charlie delta echo', 90)
    expect(lines).toEqual([
      ...wrapped,
      { text: '', from: text.length, to: text.length },
    ])
    expect(visualColumn(lines, text.length)).toBe(0)
    const above = lines[lines.length - 2]!
    expect(above.to).toBe(text.length - 1)
    // Column 0 of the row above is its first code unit.
    expect(
      offsetVertically({
        key: 'ArrowUp',
        offset: text.length,
        lines,
        column: 0,
      }),
    ).toBe(above.from)
  })

  it('carries a CRLF break the way the browser normalises it', () => {
    const lines = rowsOf('ab\r\n')
    expect(lines).toEqual([
      { text: 'ab\r', from: 0, to: 3 },
      { text: '', from: 4, to: 4 },
    ])
    expect(visualColumn(lines, 3)).toBe(3)
    expect(visualColumn(lines, 4)).toBe(0)
    expect(
      offsetVertically({ key: 'ArrowDown', offset: 3, lines, column: 3 }),
    ).toBe(4)
    expect(
      offsetVertically({ key: 'ArrowUp', offset: 4, lines, column: 0 }),
    ).toBe(0)
  })

  it('adds the empty row to a line that exactly fills the wrap width', () => {
    const text = 'alpha'
    const width = exactWidth(text)
    expect(takeLine(text, 0, FONT, width)).toBe(text.length)
    expect(rowsOf(`${text}\n`, width)).toEqual([
      { text, from: 0, to: text.length },
      { text: '', from: text.length + 1, to: text.length + 1 },
    ])
  })
})

describe('crossing a paragraph at the trailing row', () => {
  const text = 'alpha\n'
  const lines = rowsOf(text)

  it('visits the trailing row before leaving the paragraph', () => {
    const next = neighbor('below', 'beta')
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 5,
        text,
        lines,
        column: 5,
        next,
      }),
    ).toBeUndefined()
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 6,
        text,
        lines,
        column: 0,
        next,
      }),
    ).toEqual({ paragraphId: 'below', offset: 0 })
  })

  it('returns from the next paragraph to the trailing row', () => {
    const previous = neighbor('above', text)
    expect(
      offsetAfterArrow({
        key: 'ArrowUp',
        offset: 0,
        text: 'beta',
        lines: rowsOf('beta'),
        column: 0,
        previous,
      }),
    ).toEqual({ paragraphId: 'above', offset: 6 })
  })

  it('enters the paragraph above from the first row at the retained column', () => {
    const previous = neighbor('above', 'beta')
    expect(
      offsetAfterArrow({
        key: 'ArrowUp',
        offset: 0,
        text,
        lines,
        column: 4,
        previous,
      }),
    ).toEqual({ paragraphId: 'above', offset: 4 })
  })
})

describe('the desired column at the trailing row', () => {
  it('recovers the column when a long line is reached again', () => {
    const text = `${'a'.repeat(80)}\n`
    const lines = rowsOf(text)
    const next = neighbor('below', `${'b'.repeat(80)}`)
    const state = createVerticalCaretColumn()
    let offset = 40
    offset = verticalMove({ state, lines, offset, key: 'ArrowDown' })!
    expect(offset).toBe(81)
    offset = verticalMove({ state, lines, offset, key: 'ArrowUp' })!
    expect(offset).toBe(40)
    // The run still carries column 40 across the paragraph boundary.
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 81,
        text,
        lines,
        column: retainVerticalColumn(state, lines, 81),
        next,
      }),
    ).toEqual({ paragraphId: 'below', offset: 40 })
  })

  it('keeps the run while a short line above the trailing row clamps the caret', () => {
    const long = `${'a'.repeat(80)}\n`
    const lines = rowsOf(long)
    const state = createVerticalCaretColumn()
    // Start at column 40 of the long line and move down onto the empty row.
    let offset = verticalMove({ state, lines, offset: 40, key: 'ArrowDown' })!
    expect(offset).toBe(81)
    // Carry the run into a paragraph whose only line above the empty row is
    // short: the caret clamps to that line's end.
    const short = 'ab\n'
    const shortLines = rowsOf(short)
    offset = verticalMove({
      state,
      lines: shortLines,
      offset: 3,
      key: 'ArrowUp',
    })!
    expect(offset).toBe(2)
    offset = verticalMove({
      state,
      lines: shortLines,
      offset,
      key: 'ArrowDown',
    })!
    expect(offset).toBe(3)
    // The run still holds column 40, so leaving the paragraph lands there.
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 3,
        text: short,
        lines: shortLines,
        column: retainVerticalColumn(state, shortLines, 3),
        next: neighbor('below', `${'b'.repeat(80)}`),
      }),
    ).toEqual({ paragraphId: 'below', offset: 40 })
  })
})
