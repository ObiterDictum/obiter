/**
 * Exact per-glyph geometry from the PDF content stream.
 *
 * `getTextContent` aggregates glyphs into runs and reports one advance for the
 * whole run, so per-character positions can only be interpolated. Interpolation
 * is wrong for proportional faces: a redaction bar derived from it can both
 * over-cover neighbouring words and leave part of the redacted text visible,
 * which was measured at over a character of exposed ink on ordinary lines.
 *
 * The operator list carries the real numbers. `showText` arguments are glyph
 * records with the font-unit advance of each glyph, interleaved with the TJ
 * kerning adjustments, so replaying the text state machine gives exact
 * positions. This module replays it.
 */
import type { LaidChar } from './document-layout'

/** PDF transform [a b c d e f]. */
type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

/** Glyph widths are expressed in 1/1000 em. */
const FONT_UNITS = 1000

/** Baseline shift, relative to font size, that starts a new line. */
const LINE_BREAK_RATIO = 0.3

interface Glyph {
  unicode?: string
  width?: number
  isSpace?: boolean
}

interface TextState {
  fontName: string | null
  fontSize: number
  charSpacing: number
  wordSpacing: number
  hScale: number
  rise: number
  leading: number
}

/** Font ascent/descent ratios, keyed by the loaded name `setFont` reports. */
export type FontStyles = Record<
  string,
  { ascent?: number; descent?: number } | undefined
>

export interface OperatorListPage {
  fnArray: number[] | Int32Array
  argsArray: unknown[]
}

export interface PdfOps {
  save: number
  restore: number
  transform: number
  beginText: number
  endText: number
  setCharSpacing: number
  setWordSpacing: number
  setHScale: number
  setLeading: number
  setFont: number
  setTextRise: number
  moveText: number
  setLeadingMoveText: number
  setTextMatrix: number
  showText: number
  showSpacedText: number
  nextLineShowText: number
  nextLineSetSpacingShowText: number
}

function multiply(left: Matrix, right: Matrix): Matrix {
  return [
    left[0] * right[0] + left[1] * right[2],
    left[0] * right[1] + left[1] * right[3],
    left[2] * right[0] + left[3] * right[2],
    left[2] * right[1] + left[3] * right[3],
    left[4] * right[0] + left[5] * right[2] + right[4],
    left[4] * right[1] + left[5] * right[3] + right[5],
  ]
}

function translation(tx: number, ty: number): Matrix {
  return [1, 0, 0, 1, tx, ty]
}

function asMatrix(value: unknown): Matrix | null {
  // pdf.js passes matrices as arrays or as array-like objects.
  const source = value as ArrayLike<number> | undefined
  if (!source || typeof source !== 'object') return null
  const out: number[] = []
  for (let index = 0; index < 6; index += 1) {
    const entry = source[index]
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null
    out.push(entry)
  }
  return out as Matrix
}

function initialState(): TextState {
  return {
    fontName: null,
    fontSize: 0,
    charSpacing: 0,
    wordSpacing: 0,
    hScale: 1,
    rise: 0,
    leading: 0,
  }
}

/**
 * Replay one page's text operators into per-glyph laid characters. Returns an
 * empty array when the page draws no text through the glyph path (Type 3 fonts
 * and some generators), so the caller can fall back rather than lose content.
 */
export function laidCharsFromOperatorList(input: {
  operatorList: OperatorListPage
  ops: PdfOps
  pageIndex: number
  styles: FontStyles | undefined
}): LaidChar[] {
  const { operatorList, ops, pageIndex, styles } = input
  const chars: LaidChar[] = []

  let ctm: Matrix = IDENTITY
  const ctmStack: Matrix[] = []
  let textMatrix: Matrix = IDENTITY
  let lineMatrix: Matrix = IDENTITY
  let state = initialState()
  const stateStack: TextState[] = []

  const moveLine = (tx: number, ty: number) => {
    lineMatrix = multiply(translation(tx, ty), lineMatrix)
    textMatrix = lineMatrix
  }

  const show = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const entry of items) {
      if (typeof entry === 'number') {
        // TJ adjustment: a positive number moves left, in 1/1000 em.
        const shift = (-entry / FONT_UNITS) * state.fontSize * state.hScale
        textMatrix = multiply(translation(shift, 0), textMatrix)
        continue
      }
      const glyph = entry as Glyph
      const unicode = glyph.unicode ?? ''
      const advanceWidth =
        typeof glyph.width === 'number' ? glyph.width / FONT_UNITS : 0

      // Glyph space → text space → user space.
      const scaling: Matrix = [
        state.fontSize * state.hScale,
        0,
        0,
        state.fontSize,
        0,
        state.rise,
      ]
      const render = multiply(multiply(scaling, textMatrix), ctm)
      const placement = multiply(textMatrix, ctm)
      const horizontal = Math.hypot(placement[0], placement[1]) || 1
      const size = Math.hypot(render[2], render[3]) || state.fontSize

      const advance =
        (advanceWidth * state.fontSize +
          state.charSpacing +
          (glyph.isSpace ? state.wordSpacing : 0)) *
        state.hScale

      if (unicode) {
        const ascentRatio =
          typeof styles?.[state.fontName ?? '']?.ascent === 'number' &&
          styles[state.fontName ?? '']!.ascent! > 0
            ? styles[state.fontName ?? '']!.ascent!
            : 0.8
        const descentRatio =
          typeof styles?.[state.fontName ?? '']?.descent === 'number'
            ? Math.abs(styles[state.fontName ?? '']!.descent!)
            : 0.2
        // A glyph's own advance is its width; ligatures map to several
        // characters, which share the one advance they were drawn with.
        const perChar = advance / Math.max([...unicode].length, 1)
        let offset = 0
        for (const ch of unicode) {
          chars.push({
            ch,
            pageIndex,
            x: render[4] + offset * horizontal,
            y: render[5],
            width: Math.abs(perChar * horizontal),
            height: size,
            ascent: size * ascentRatio,
            descent: size * descentRatio,
          })
          offset += perChar
        }
      }

      textMatrix = multiply(translation(advance, 0), textMatrix)
    }
  }

  const { fnArray, argsArray } = operatorList
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    const args = argsArray[index] as unknown[] | undefined

    switch (fn) {
      case ops.save:
        ctmStack.push(ctm)
        stateStack.push({ ...state })
        break
      case ops.restore:
        ctm = ctmStack.pop() ?? IDENTITY
        state = stateStack.pop() ?? initialState()
        break
      case ops.transform: {
        const matrix = asMatrix(args?.length === 1 ? args[0] : args)
        if (matrix) ctm = multiply(matrix, ctm)
        break
      }
      case ops.beginText:
        textMatrix = IDENTITY
        lineMatrix = IDENTITY
        break
      case ops.endText:
        break
      case ops.setFont:
        state.fontName = (args?.[0] as string) ?? state.fontName
        state.fontSize =
          typeof args?.[1] === 'number' ? args[1] : state.fontSize
        break
      case ops.setCharSpacing:
        state.charSpacing = (args?.[0] as number) ?? 0
        break
      case ops.setWordSpacing:
        state.wordSpacing = (args?.[0] as number) ?? 0
        break
      case ops.setHScale:
        // Tz is a percentage.
        state.hScale = ((args?.[0] as number) ?? 100) / 100
        break
      case ops.setTextRise:
        state.rise = (args?.[0] as number) ?? 0
        break
      case ops.setLeading:
        state.leading = (args?.[0] as number) ?? 0
        break
      case ops.setLeadingMoveText: {
        const tx = (args?.[0] as number) ?? 0
        const ty = (args?.[1] as number) ?? 0
        state.leading = -ty
        moveLine(tx, ty)
        break
      }
      case ops.moveText:
        moveLine((args?.[0] as number) ?? 0, (args?.[1] as number) ?? 0)
        break
      case ops.setTextMatrix: {
        const matrix = asMatrix(args?.length === 1 ? args[0] : args)
        if (matrix) {
          textMatrix = matrix
          lineMatrix = matrix
        }
        break
      }
      case ops.showText:
      case ops.showSpacedText:
        show(args?.[0])
        break
      case ops.nextLineShowText:
        moveLine(0, -state.leading)
        show(args?.[0])
        break
      case ops.nextLineSetSpacingShowText:
        state.wordSpacing = (args?.[0] as number) ?? state.wordSpacing
        state.charSpacing = (args?.[1] as number) ?? state.charSpacing
        moveLine(0, -state.leading)
        show(args?.[2])
        break
      default:
        break
    }
  }

  return chars
}

/**
 * Insert newlines between glyphs that sit on different baselines. The operator
 * list has no end-of-line marker, so reading order comes from geometry: a
 * baseline shift, or a carriage return to the left on the same baseline.
 */
export function withLineBreaks(chars: LaidChar[]): LaidChar[] {
  const out: LaidChar[] = []
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index]!
    const previous = chars[index - 1]
    if (previous) {
      const threshold =
        Math.max(previous.height, current.height, 1) * LINE_BREAK_RATIO
      const droppedLine = Math.abs(previous.y - current.y) > threshold
      const carriageReturn =
        !droppedLine && current.x + current.width < previous.x
      if (droppedLine || carriageReturn) {
        out.push({
          ch: '\n',
          pageIndex: previous.pageIndex,
          x: previous.x + previous.width,
          y: previous.y,
          width: 0,
          height: previous.height,
          ascent: previous.ascent,
          descent: previous.descent,
        })
      }
    }
    out.push(current)
  }
  return out
}
