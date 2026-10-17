import { describe, expect, it } from 'bun:test'
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

function fragment(text: string, offset = 0, textIndentPx = 0) {
  return takeFragment({
    text,
    offset,
    startY: 0,
    maxY: FRAME.heightPx,
    linePx: LINE_PX,
    fontSize: FONT,
    indent: 0,
    textIndentPx,
    column: COLUMN,
    frame: FRAME,
    floats: [],
  })
}

/** The column these tests wrap against: several words wide, so an indent moves
 * the break rather than merely shortening a row that already fits. */
const WRAP_WIDTH = 240
const FIRST_LINE = 90
const WRAP_TEXT = 'alpha bravo charlie delta echo foxtrot golf hotel india'

/** A fragment of a paragraph wrapped against `WRAP_WIDTH` rather than `COLUMN`,
 * which is deliberately too wide to wrap at all. */
function fragmentAt(
  text: string,
  offset: number,
  textIndentPx: number,
  widthPx: number,
  /** Rows of room. One row makes `shown` exactly the first row's end. */
  maxY = FRAME.heightPx,
) {
  return takeFragment({
    text,
    offset,
    startY: 0,
    maxY,
    linePx: LINE_PX,
    fontSize: FONT,
    indent: 0,
    textIndentPx,
    column: { left: 0, widthPx },
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

describe('first-line indent', () => {
  it('breaks line 1 where the indent leaves off, not where the full width ends', () => {
    const bodyBreak = takeLine(WRAP_TEXT, 0, FONT, WRAP_WIDTH)
    const firstBreak = takeLine(WRAP_TEXT, 0, FONT, WRAP_WIDTH - FIRST_LINE)
    expect(firstBreak).toBeLessThan(bodyBreak)
    const lines = wrapLines(WRAP_TEXT, FONT, WRAP_WIDTH, undefined, FIRST_LINE)
    expect(lines[0].text).toBe(WRAP_TEXT.slice(0, firstBreak))
    // The rows after the first are body rows: they wrap the remainder against
    // the full width, exactly as an unindented wrap of that remainder would.
    expect(lines.slice(1).map((line) => line.text)).toEqual(
      wrapLines(WRAP_TEXT.slice(firstBreak), FONT, WRAP_WIDTH).map(
        (line) => line.text,
      ),
    )
  })

  it('gives line 1 the width a hanging indent reaches back for', () => {
    const lines = wrapLines(WRAP_TEXT, FONT, WRAP_WIDTH, undefined, -FIRST_LINE)
    expect(lines[0].text).toBe(
      WRAP_TEXT.slice(0, takeLine(WRAP_TEXT, 0, FONT, WRAP_WIDTH + FIRST_LINE)),
    )
    expect(lines[0].text.length).toBeGreaterThan(
      wrapLines(WRAP_TEXT, FONT, WRAP_WIDTH)[0].text.length,
    )
  })

  it('places the painted first row where the editor wraps it', () => {
    const editor = wrapLines(WRAP_TEXT, FONT, WRAP_WIDTH, undefined, FIRST_LINE)
    const painted = fragmentAt(WRAP_TEXT, 0, FIRST_LINE, WRAP_WIDTH, LINE_PX)
    expect(painted.shown).toBe(editor[0].text.length)
    expect(painted.consumed).toBe(editor[0].text.length)
    // The agreement only means something if the indent moved the row: compare
    // against the same paint with no first-line indent.
    expect(painted.shown).toBeLessThan(
      fragmentAt(WRAP_TEXT, 0, 0, WRAP_WIDTH, LINE_PX).shown,
    )
    expect(countLines(WRAP_TEXT, FONT, WRAP_WIDTH, undefined, FIRST_LINE)).toBe(
      editor.length,
    )
  })

  it('measures the painted first row against the width it is drawn in', () => {
    // The overflow this fixes: the row was wrapped against the full column and
    // then shifted right by the indent, so its glyphs ran past the frame. The
    // row the paint places now fits the width the indent left.
    const placed = fragmentAt(WRAP_TEXT, 0, FIRST_LINE, WRAP_WIDTH, LINE_PX)
    const row = WRAP_TEXT.slice(0, placed.shown)
    expect(takeLine(row, 0, FONT, WRAP_WIDTH - FIRST_LINE)).toBe(row.length)
    expect(placed.shown).toBeLessThan(
      fragmentAt(WRAP_TEXT, 0, 0, WRAP_WIDTH, LINE_PX).shown,
    )
  })

  it('applies the indent to a paragraph first row, not to a later fragment', () => {
    // A continuation starts mid-paragraph, so its opening row is a body row and
    // both surfaces have to leave it the full width.
    const body = fragmentAt(WRAP_TEXT, 10, 0, WRAP_WIDTH)
    const indented = fragmentAt(WRAP_TEXT, 10, FIRST_LINE, WRAP_WIDTH)
    expect(indented.shown).toBe(body.shown)
    expect(indented.consumed).toBe(body.consumed)
    // The same indent at offset 0 does move the row, or the equality above
    // would hold for a reason that has nothing to do with the offset.
    expect(
      fragmentAt(WRAP_TEXT, 0, FIRST_LINE, WRAP_WIDTH, LINE_PX).shown,
    ).toBeLessThan(fragmentAt(WRAP_TEXT, 0, 0, WRAP_WIDTH, LINE_PX).shown)
  })

  it('wraps an indented paragraph to the same rows the paint counts', () => {
    const texts = ['alpha bravo', 'alpha', 'alpha\nbravo charlie delta echo']
    const firstBreak = takeLine(WRAP_TEXT, 0, FONT, WRAP_WIDTH - FIRST_LINE)
    // The indented row 1 ends where the narrowed width ends, and every other
    // row is a body row, so the paragraph is that row plus the rows the
    // remainder needs at the full width — in both the editor and the paint.
    expect(
      wrapLines(WRAP_TEXT, FONT, WRAP_WIDTH, undefined, FIRST_LINE).length,
    ).toBe(1 + wrapLines(WRAP_TEXT.slice(firstBreak), FONT, WRAP_WIDTH).length)
    for (const text of texts) {
      expect(
        countLines(text, FONT, WRAP_WIDTH, undefined, FIRST_LINE),
        text,
      ).toBe(wrapLines(text, FONT, WRAP_WIDTH, undefined, FIRST_LINE).length)
    }
    expect(countLines(WRAP_TEXT, FONT, WRAP_WIDTH, undefined, FIRST_LINE)).toBe(
      1 + countLines(WRAP_TEXT.slice(firstBreak), FONT, WRAP_WIDTH),
    )
  })
})
