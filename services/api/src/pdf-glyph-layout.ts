import type { LaidChar } from './document-layout'

type Matrix = [number, number, number, number, number, number]

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

const FONT_UNITS = 1000

const LINE_BREAK_RATIO = 0.3

const SEMANTIC_SPACE_RATIO = 0.2

interface Glyph {
  unicode?: string
  width?: number
  isSpace?: boolean
  vmetric?: unknown
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

export type FontStyles = Record<
  string,
  { ascent?: number; descent?: number; vertical?: boolean } | undefined
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
  setGState: number
  setTextRise: number
  moveText: number
  setLeadingMoveText: number
  setTextMatrix: number
  nextLine: number
  showText: number
  showSpacedText: number
  nextLineShowText: number
  nextLineSetSpacingShowText: number
  paintFormXObjectBegin: number
  paintFormXObjectEnd: number
  beginAnnotation: number
  endAnnotation: number
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

function ctmIsIdentity(matrix: Matrix) {
  return (
    Math.abs(matrix[0] - 1) < 0.001 &&
    Math.abs(matrix[1]) < 0.001 &&
    Math.abs(matrix[2]) < 0.001 &&
    Math.abs(matrix[3] - 1) < 0.001 &&
    Math.abs(matrix[4]) < 0.001 &&
    Math.abs(matrix[5]) < 0.001
  )
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function numericArgument(
  args: unknown[] | undefined,
  index: number,
): number | null {
  return asNumber(args?.[index])
}

function asMatrix(value: unknown): Matrix | null {
  // SAFETY: pdf.js supplies matrices as arrays or array-like objects; every
  const source = value as ArrayLike<number> | undefined
  if (!source || typeof source !== 'object') return null
  const out: number[] = []
  for (let index = 0; index < 6; index += 1) {
    const entry = source[index]
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null
    out.push(entry)
  }
  // SAFETY: the loop above pushed exactly six finite numbers.
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

export function laidCharsFromOperatorList(input: {
  operatorList: OperatorListPage
  ops: PdfOps
  pageIndex: number
  styles: FontStyles | undefined
}): LaidChar[] {
  const { operatorList, ops, pageIndex, styles } = input
  const chars: LaidChar[] = []

  let ctm: Matrix = IDENTITY
  let textMatrix: Matrix = IDENTITY
  let lineMatrix: Matrix = IDENTITY
  let state = initialState()
  const graphicsStack: Array<{
    ctm: Matrix
    textMatrix: Matrix
    lineMatrix: Matrix
    state: TextState
  }> = []

  const pushGraphicsState = () => {
    graphicsStack.push({ ctm, textMatrix, lineMatrix, state: { ...state } })
  }

  const restoreGraphicsState = () => {
    const restored = graphicsStack.pop()
    if (!restored) return
    ctm = restored.ctm
    textMatrix = restored.textMatrix
    lineMatrix = restored.lineMatrix
    state = restored.state
  }

  const moveLine = (tx: number, ty: number) => {
    lineMatrix = multiply(translation(tx, ty), lineMatrix)
    textMatrix = lineMatrix
  }

  const applyFont = (name: unknown, size: unknown) => {
    if (typeof name === 'string') state.fontName = name
    if (typeof size === 'number') state.fontSize = size
  }

  const show = (items: unknown) => {
    if (!Array.isArray(items)) return
    for (const entry of items) {
      if (typeof entry === 'number') {
        const shift = (-entry / FONT_UNITS) * state.fontSize * state.hScale
        textMatrix = multiply(translation(shift, 0), textMatrix)
        continue
      }
      // SAFETY: a showText array holds pdf.js glyph records; unicode, width
      const glyph = entry as Glyph
      const unicode = glyph.unicode ?? ''
      const advanceWidth =
        typeof glyph.width === 'number' ? glyph.width / FONT_UNITS : 0

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
      const baselineMagnitude = Math.hypot(render[0], render[1]) || 1
      const baselineX = render[0] / baselineMagnitude
      const baselineY = render[1] / baselineMagnitude
      const size = Math.hypot(render[2], render[3]) || state.fontSize
      const axisAlignment =
        (render[0] * render[2] + render[1] * render[3]) /
        (baselineMagnitude * (size || 1))
      const skewed = Math.abs(axisAlignment) > 0.01

      const glyphAdvance = advanceWidth * state.fontSize * state.hScale
      const advance =
        (advanceWidth * state.fontSize +
          state.charSpacing +
          (glyph.isSpace ? state.wordSpacing : 0)) *
        state.hScale

      if (unicode) {
        const styleAscent = styles?.[state.fontName ?? '']?.ascent
        const ascentRatio =
          typeof styleAscent === 'number' &&
          Number.isFinite(styleAscent) &&
          styleAscent > 0
            ? styleAscent
            : 0.8
        const styleDescent = styles?.[state.fontName ?? '']?.descent
        const descentRatio =
          typeof styleDescent === 'number' && Number.isFinite(styleDescent)
            ? Math.abs(styleDescent)
            : 0.2
        const perCharWidth =
          Math.abs(glyphAdvance * horizontal) / Math.max([...unicode].length, 1)
        let offset = 0
        for (const ch of unicode) {
          chars.push({
            ch,
            pageIndex,
            x: render[4] + offset * baselineX,
            y: render[5] + offset * baselineY,
            width: perCharWidth,
            height: size,
            ascent: size * ascentRatio,
            descent: size * descentRatio,
            baselineX,
            baselineY,
            ...(skewed ? { skewed: true } : {}),
            ...(ctmIsIdentity(ctm) ? {} : { transformed: true }),
          })
          offset += perCharWidth
        }
      }

      textMatrix = multiply(translation(advance, 0), textMatrix)
    }
  }

  const { fnArray, argsArray } = operatorList
  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    // SAFETY: pdf.js emits each operator's arguments as an array, or omits
    const args = argsArray[index] as unknown[] | undefined

    switch (fn) {
      case ops.save:
        pushGraphicsState()
        break
      case ops.restore:
        restoreGraphicsState()
        break
      case ops.transform: {
        const matrix = asMatrix(args?.length === 1 ? args[0] : args)
        if (matrix) ctm = multiply(matrix, ctm)
        break
      }
      case ops.paintFormXObjectBegin: {
        pushGraphicsState()
        const matrix = asMatrix(args?.[0])
        if (matrix) ctm = multiply(matrix, ctm)
        break
      }
      case ops.paintFormXObjectEnd:
        restoreGraphicsState()
        break
      case ops.beginAnnotation: {
        pushGraphicsState()
        ctm = IDENTITY
        const transform = asMatrix(args?.[2])
        if (transform) ctm = multiply(transform, ctm)
        const matrix = asMatrix(args?.[3])
        if (matrix) ctm = multiply(matrix, ctm)
        break
      }
      case ops.endAnnotation:
        restoreGraphicsState()
        break
      case ops.beginText:
        textMatrix = IDENTITY
        lineMatrix = IDENTITY
        break
      case ops.endText:
        break
      case ops.setFont:
        applyFont(args?.[0], args?.[1])
        break
      case ops.setGState: {
        const entries = args?.[0]
        if (Array.isArray(entries)) {
          for (const entry of entries) {
            if (Array.isArray(entry) && entry[0] === 'Font') {
              const font = entry[1]
              if (Array.isArray(font)) applyFont(font[0], font[1])
            }
          }
        }
        break
      }
      case ops.setCharSpacing:
        state.charSpacing = numericArgument(args, 0) ?? 0
        break
      case ops.setWordSpacing:
        state.wordSpacing = numericArgument(args, 0) ?? 0
        break
      case ops.setHScale:
        state.hScale = (numericArgument(args, 0) ?? 100) / 100
        break
      case ops.setTextRise:
        state.rise = numericArgument(args, 0) ?? 0
        break
      case ops.setLeading:
        state.leading = numericArgument(args, 0) ?? 0
        break
      case ops.setLeadingMoveText: {
        const tx = numericArgument(args, 0) ?? 0
        const ty = numericArgument(args, 1) ?? 0
        state.leading = -ty
        moveLine(tx, ty)
        break
      }
      case ops.moveText:
        moveLine(numericArgument(args, 0) ?? 0, numericArgument(args, 1) ?? 0)
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
      case ops.nextLine:
        moveLine(0, -state.leading)
        break
      case ops.nextLineShowText:
        moveLine(0, -state.leading)
        show(args?.[0])
        break
      case ops.nextLineSetSpacingShowText:
        state.wordSpacing = numericArgument(args, 0) ?? state.wordSpacing
        state.charSpacing = numericArgument(args, 1) ?? state.charSpacing
        moveLine(0, -state.leading)
        show(args?.[2])
        break
      default:
        break
    }
  }

  return chars
}

export function withLineBreaks(chars: LaidChar[]): LaidChar[] {
  const out: LaidChar[] = []
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index]
    if (!current) continue
    const previous = chars[index - 1]
    if (previous) {
      const deltaX = current.x - previous.x
      const deltaY = current.y - previous.y
      const threshold =
        Math.max(previous.height, current.height, 1) * LINE_BREAK_RATIO
      const directionMatch =
        previous.baselineX * current.baselineX +
        previous.baselineY * current.baselineY
      const perpendicular =
        deltaX * -previous.baselineY + deltaY * previous.baselineX
      const along = deltaX * previous.baselineX + deltaY * previous.baselineY
      const droppedLine =
        directionMatch < 0.95 || Math.abs(perpendicular) > threshold
      const carriageReturn = !droppedLine && along < 0
      if (droppedLine || carriageReturn) {
        out.push({
          ch: '\n',
          pageIndex: previous.pageIndex,
          x: previous.x + previous.width * previous.baselineX,
          y: previous.y + previous.width * previous.baselineY,
          width: 0,
          height: previous.height,
          ascent: previous.ascent,
          descent: previous.descent,
          baselineX: previous.baselineX,
          baselineY: previous.baselineY,
        })
      }
    }
    out.push(current)
  }
  return out
}

export function withSemanticSpaces(chars: LaidChar[]): LaidChar[] {
  const out: LaidChar[] = []
  for (const current of chars) {
    const previous = out.at(-1)
    if (
      previous &&
      previous.ch !== '\n' &&
      current.ch !== '\n' &&
      !/\s/u.test(previous.ch) &&
      !/\s/u.test(current.ch)
    ) {
      const deltaX = current.x - previous.x
      const deltaY = current.y - previous.y
      const directionMatch =
        previous.baselineX * current.baselineX +
        previous.baselineY * current.baselineY
      const perpendicular =
        deltaX * -previous.baselineY + deltaY * previous.baselineX
      const along = deltaX * previous.baselineX + deltaY * previous.baselineY
      const threshold =
        Math.max(previous.height, current.height, 1) * SEMANTIC_SPACE_RATIO
      const sameBaseline =
        directionMatch > 0.95 && Math.abs(perpendicular) <= threshold
      const gap = along - previous.width

      if (sameBaseline && gap > threshold) {
        out.push({
          ch: ' ',
          pageIndex: previous.pageIndex,
          x: previous.x + previous.width * previous.baselineX,
          y: previous.y + previous.width * previous.baselineY,
          width: gap,
          height: previous.height,
          ascent: previous.ascent,
          descent: previous.descent,
          baselineX: previous.baselineX,
          baselineY: previous.baselineY,
        })
      }
    }
    out.push(current)
  }
  return out
}
