import { lineInset, type PageFloat } from './document-page-floats'
import type { ColumnFrame, ContentFrame } from './document-page-layout'

export const MEASURE_FONT = 'Calibri, "Segoe UI", "Liberation Sans", sans-serif'

/**
 * One row of the browser's visual line model: it carries the display code units
 * `[from, to)` a textarea paints on that row. A hard break terminates the row
 * it ends rather than displaying, so the row it terminates ends one code unit
 * before the next row starts. The offset that renders at a row's visual end is
 * `to`, owned by this row when the next row starts after it (hard break) or it
 * is the final row, and owned by the next row when they share a soft-wrap
 * boundary.
 */
export type WrappedLine = {
  text: string
  from: number
  to: number
}

export function takeFragment(input: {
  text: string
  offset: number
  startY: number
  maxY: number
  linePx: number
  fontSize: number
  fontFamily?: string
  indent: number
  column: ColumnFrame
  frame: ContentFrame
  floats: PageFloat[]
}): {
  /** Display code units placed, so the block slice is `[offset, offset + shown)`. */
  shown: number
  /** Code units consumed, so the next fragment resumes at `offset + consumed`. */
  consumed: number
  heightPx: number
  padLeftPx: number
  padRightPx: number
  lines: number
  /** Every row of the text is placed, the trailing empty one included. */
  complete: boolean
  skipTo?: number
} {
  if (!input.text) {
    return {
      shown: 0,
      consumed: 0,
      heightPx: input.linePx,
      padLeftPx: 0,
      padRightPx: 0,
      lines: 1,
      complete: true,
    }
  }
  let y = input.startY
  let offset = input.offset
  let shown = 0
  let padLeftPx = 0
  let padRightPx = 0
  let lines = 0
  let padsLocked = false
  // A textarea paints an empty row after a trailing break. It consumes no code
  // units, so the loop needs its own flag to place it rather than `offset`.
  let trailingRow = input.text.endsWith('\n')
  while (offset < input.text.length || trailingRow) {
    const inset = lineInset(
      input.frame.top + y,
      input.linePx,
      input.column,
      input.frame,
      input.floats,
    )
    if (inset.skipTo !== undefined) {
      if (lines === 0) {
        return {
          shown: 0,
          consumed: 0,
          heightPx: 0,
          padLeftPx: 0,
          padRightPx: 0,
          lines: 0,
          complete: false,
          skipTo: inset.skipTo,
        }
      }
      break
    }
    if (y + input.linePx > input.maxY) break
    if (
      padsLocked &&
      (inset.padLeftPx !== padLeftPx || inset.padRightPx !== padRightPx)
    ) {
      break
    }
    padLeftPx = inset.padLeftPx
    padRightPx = inset.padRightPx
    padsLocked = true
    if (offset < input.text.length) {
      const width = Math.max(
        1,
        input.column.widthPx - input.indent - padLeftPx - padRightPx,
      )
      const taken = takeLine(
        input.text,
        offset,
        input.fontSize,
        width,
        input.fontFamily,
      )
      if (taken === 0) break
      const raw = input.text.slice(offset, offset + taken)
      const display = raw.endsWith('\n') ? raw.length - 1 : raw.length
      shown = offset - input.offset + display
      offset += taken
    } else {
      // The empty row after a trailing break sits at the end of the text.
      shown = offset - input.offset
      trailingRow = false
    }
    y += input.linePx
    lines += 1
  }
  return {
    shown,
    consumed: offset - input.offset,
    heightPx: Math.max(input.linePx, lines * input.linePx),
    padLeftPx,
    padRightPx,
    lines,
    // An unplaced trailing row is not a finished paragraph even though the
    // code units are exhausted, so the caller advances the page for it.
    complete: !trailingRow && offset >= input.text.length,
  }
}

export function countLines(
  text: string,
  fontSizePx: number,
  widthPx: number,
  fontFamily?: string,
): number {
  if (!text) return 1
  let offset = 0
  let lines = 0
  while (offset < text.length) {
    const taken = takeLine(text, offset, fontSizePx, widthPx, fontFamily)
    if (taken === 0) break
    offset += taken
    lines += 1
  }
  // A trailing break opens a further empty row, so the paragraph is one row
  // taller than its break-terminated segments.
  return Math.max(1, lines) + (text.endsWith('\n') ? 1 : 0)
}

/**
 * Display spans for a paragraph in the browser's visual line model: one row per
 * hard-break segment plus soft wraps, and the empty row a trailing break opens.
 * A row's `to` excludes the newline that terminates it, so a hard break leaves
 * a one code unit gap before the next row while a soft wrap shares its
 * boundary, which `lineIndex` in `paragraph-arrow.ts` relies on to decide caret
 * ownership at a break.
 */
export function wrapLines(
  text: string,
  fontSizePx: number,
  widthPx: number,
  fontFamily?: string,
): WrappedLine[] {
  if (!text) return [{ text: '', from: 0, to: 0 }]
  const lines: WrappedLine[] = []
  let offset = 0
  while (offset < text.length) {
    const taken = takeLine(text, offset, fontSizePx, widthPx, fontFamily)
    if (taken === 0) break
    const raw = text.slice(offset, offset + taken)
    const display = raw.endsWith('\n') ? raw.slice(0, -1) : raw
    lines.push({
      text: display,
      from: offset,
      to: offset + display.length,
    })
    offset += taken
  }
  // The projection owns the caret offset a textarea shows at `text.length`.
  if (text.endsWith('\n')) {
    lines.push({ text: '', from: text.length, to: text.length })
  }
  return lines.length > 0 ? lines : [{ text: '', from: 0, to: 0 }]
}

export function takeLine(
  text: string,
  offset: number,
  fontSizePx: number,
  widthPx: number,
  fontFamily = MEASURE_FONT,
): number {
  const rest = text.slice(offset)
  if (!rest) return 0
  if (rest.startsWith('\n')) return 1
  const newline = rest.indexOf('\n')
  const haystack = newline === -1 ? rest : rest.slice(0, newline)
  if (textWidthPx(haystack, fontSizePx, fontFamily) <= widthPx) {
    return newline === -1 ? rest.length : newline + 1
  }
  const first = haystack[0]
  if (first && textWidthPx(first, fontSizePx, fontFamily) > widthPx) {
    // The character overflows on its own. It still holds its row, and a newline
    // directly after it terminates that row rather than opening an empty one.
    return newline === 1 ? 2 : 1
  }
  let lo = 1
  let hi = haystack.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (
      textWidthPx(haystack.slice(0, mid), fontSizePx, fontFamily) <= widthPx
    ) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  let lastBreak = 0
  for (let index = 0; index < lo; index += 1) {
    const char = haystack[index]
    if (char === ' ' || char === '-') lastBreak = index + 1
  }
  if (lastBreak > 0) return lastBreak
  for (let index = lo; index < haystack.length; index += 1) {
    const char = haystack[index]
    if (char === ' ' || char === '-') return index + 1
  }
  return newline === -1 ? rest.length : newline + 1
}

function textWidthPx(
  text: string,
  fontSizePx: number,
  fontFamily: string,
): number {
  if (!text) return 0
  const ctx = measureContext()
  if (ctx) {
    ctx.font = `${fontSizePx}px ${fontFamily}`
    const width = ctx.measureText(text).width
    if (width > 0) return width
  }
  return glyphStringWidth(text, fontSizePx)
}

let measureCtx: CanvasRenderingContext2D | null | undefined

function measureContext(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx
  if (
    typeof document === 'undefined' ||
    (typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))
  ) {
    measureCtx = null
    return null
  }
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      measureCtx = null
      return null
    }
    ctx.font = `16px ${MEASURE_FONT}`
    if (ctx.measureText('M').width === 0) {
      measureCtx = null
      return null
    }
    measureCtx = ctx
    return ctx
  } catch {
    measureCtx = null
    return null
  }
}

function glyphStringWidth(text: string, fontSizePx: number): number {
  let width = 0
  for (const char of text) width += glyphWidth(char, fontSizePx)
  return width
}

function glyphWidth(char: string, fontSizePx: number): number {
  if (char === ' ' || char === '\u00a0') return fontSizePx * 0.226
  if (char === '\t') return fontSizePx * 2
  if ('WM@%m'.includes(char)) return fontSizePx * 0.78
  if ("ilI.,:;!|'`.()[]{}".includes(char)) return fontSizePx * 0.28
  if ('ftjrs-'.includes(char)) return fontSizePx * 0.36
  return fontSizePx * 0.5
}
