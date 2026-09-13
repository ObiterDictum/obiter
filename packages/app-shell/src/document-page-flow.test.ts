import { describe, expect, it } from 'vitest'
import {
  countLines,
  takeFragment,
  takeLine,
  wrapLines,
} from './document-page-flow'

const FONT = 16
// A width no line can reach, so the projection shows the break structure
// alone: one row per hard-break segment.
const NO_WRAP = 10_000_000
const LINE_PX = 20
const FRAME = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  widthPx: NO_WRAP,
  heightPx: 10_000,
}
const COLUMN = { left: 0, widthPx: NO_WRAP }

const BREAK_TEXTS = [
  '',
  'alpha',
  'alpha\n',
  'alpha\n\n',
  'alpha\nbeta',
  'alpha\nbeta\n',
  '\n',
  '\n\n',
  '\n\nalpha\n',
  'alpha\n\nbeta\n\n',
]

function fragment(text: string, offset = 0) {
  return takeFragment({
    text,
    offset,
    startY: 0,
    maxY: FRAME.heightPx,
    linePx: LINE_PX,
    fontSize: FONT,
    indent: 0,
    column: COLUMN,
    frame: FRAME,
    floats: [],
  })
}

/**
 * The row model the browser itself uses for the same text: a textarea renders
 * one row per newline-separated segment, and a text ends with an empty row when
 * it ends with a break. `String.split` on the break character is that model.
 */
function browserRows(text: string): string[] {
  return text.split('\n')
}

/**
 * Structural violations of the visual row model, checked without reference to
 * how `wrapLines` computes the rows:
 *
 * - rows start at 0, stay inside the text and draw the code units they cover;
 * - adjacent rows either share a soft-wrap boundary or are one newline apart;
 * - every newline in the text is the terminator of exactly one row;
 * - the last row reaches the end of the text.
 */
function rowModelIssues(text: string, widthPx: number): string[] {
  const rows = wrapLines(text, FONT, widthPx)
  const issues: string[] = []
  const terminators = new Map<number, number>()
  if (rows.length === 0) return ['no rows']
  if (rows[0]?.from !== 0) issues.push('first row does not start at 0')
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    if (row.from < 0 || row.to < row.from || row.to > text.length) {
      issues.push(`row ${index} is out of bounds [${row.from}, ${row.to})`)
      continue
    }
    if (row.text !== text.slice(row.from, row.to)) {
      issues.push(`row ${index} does not draw its own code units`)
    }
    if (row.to < text.length) {
      terminators.set(row.to, (terminators.get(row.to) ?? 0) + 1)
    }
    const next = rows[index + 1]
    if (!next) continue
    const gap = next.from - row.to
    if (gap === 0) continue
    if (gap !== 1 || text[row.to] !== '\n') {
      issues.push(
        `row ${index} to row ${index + 1} is neither a wrap nor a break`,
      )
    }
  }
  for (const [index, count] of terminators) {
    if (count !== 1) issues.push(`newline ${index} terminates ${count} rows`)
  }
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && !terminators.has(index)) {
      issues.push(`newline ${index} terminates no row`)
    }
  }
  if (rows[rows.length - 1]?.to !== text.length) {
    issues.push('last row does not reach the end of the text')
  }
  return issues
}

describe('takeLine', () => {
  it('wraps on spaces using measured glyph widths, not a fixed character grid', () => {
    const text = 'alpha bravo charlie delta echo'
    const taken = takeLine(text, 0, 16, 80)
    expect(taken).toBeGreaterThan(0)
    expect(text.slice(0, taken).endsWith(' ')).toBe(true)
    expect(taken).toBeLessThan(text.length)
  })

  it('treats a newline as a hard break', () => {
    expect(takeLine('Hello\nWorld', 0, 16, 400)).toBe(6)
  })

  it('keeps an overflowing first word on the line, as Word does', () => {
    const word = 'Supercalifragilistic'
    const taken = takeLine(`${word} next`, 0, 16, 10)
    expect(taken).toBe(word.length + 1)
  })

  it('wraps a long unbroken token without scanning every prefix', () => {
    const token = 'A'.repeat(4000)
    expect(takeLine(`${token} tail`, 0, 16, 80)).toBe(4000 + 1)
    expect(takeLine(token, 0, 16, 50_000)).toBe(4000)
  })

  it('carries the newline with the overflowing character it terminates', () => {
    // A column narrower than one glyph still breaks the row at the newline: the
    // newline terminates the row holding the character before it.
    expect(takeLine('b\nnext', 0, 16, 1)).toBe(2)
  })
})

describe('countLines', () => {
  it('counts an empty paragraph as one line', () => {
    expect(countLines('', 16, 200)).toBe(1)
  })
})

describe('wrapLines', () => {
  it('splits wrapped text into display lines without the break space joining the next line', () => {
    const lines = wrapLines('alpha bravo charlie delta echo', 16, 80)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every((line) => !line.text.startsWith(' '))).toBe(true)
  })
})

describe('trailing hard-break row', () => {
  it('projects the empty row a trailing hard break opens', () => {
    expect(wrapLines('alpha\n', FONT, NO_WRAP)).toEqual([
      { text: 'alpha', from: 0, to: 5 },
      { text: '', from: 6, to: 6 },
    ])
  })

  it('projects the intervening and trailing rows of consecutive breaks', () => {
    expect(wrapLines('alpha\n\n', FONT, NO_WRAP)).toEqual([
      { text: 'alpha', from: 0, to: 5 },
      { text: '', from: 6, to: 6 },
      { text: '', from: 7, to: 7 },
    ])
    expect(wrapLines('\n', FONT, NO_WRAP)).toEqual([
      { text: '', from: 0, to: 0 },
      { text: '', from: 1, to: 1 },
    ])
    expect(wrapLines('\n\n', FONT, NO_WRAP)).toEqual([
      { text: '', from: 0, to: 0 },
      { text: '', from: 1, to: 1 },
      { text: '', from: 2, to: 2 },
    ])
  })

  it('adds no row when the text does not end in a break', () => {
    expect(wrapLines('', FONT, NO_WRAP)).toEqual([{ text: '', from: 0, to: 0 }])
    expect(wrapLines('alpha', FONT, NO_WRAP)).toEqual([
      { text: 'alpha', from: 0, to: 5 },
    ])
    expect(wrapLines('alpha\nbeta', FONT, NO_WRAP)).toEqual([
      { text: 'alpha', from: 0, to: 5 },
      { text: 'beta', from: 6, to: 10 },
    ])
  })

  it('matches the browser row model', () => {
    for (const text of BREAK_TEXTS) {
      expect(wrapLines(text, FONT, NO_WRAP).map((line) => line.text)).toEqual(
        browserRows(text),
      )
    }
  })

  it('counts the rows the projection draws', () => {
    for (const text of BREAK_TEXTS) {
      expect(countLines(text, FONT, NO_WRAP)).toBe(
        wrapLines(text, FONT, NO_WRAP).length,
      )
    }
  })

  it('holds the row model at every wrap width', () => {
    for (const text of BREAK_TEXTS) {
      for (const width of [1, 40, 90, 200, NO_WRAP]) {
        expect(rowModelIssues(text, width)).toEqual([])
      }
    }
  })
})

describe('takeFragment and the trailing row', () => {
  it('reserves a page row for the empty row after a trailing break', () => {
    const placed = fragment('alpha\n')
    expect(placed.lines).toBe(2)
    expect(placed.heightPx).toBe(2 * LINE_PX)
    expect(placed.consumed).toBe(6)
  })

  it('charges no extra row when the break is not trailing', () => {
    expect(fragment('alpha\nbeta').lines).toBe(2)
  })

  it('reserves a row for a break-only paragraph', () => {
    expect(fragment('\n').lines).toBe(2)
    expect(fragment('\n\n').lines).toBe(3)
  })
})
