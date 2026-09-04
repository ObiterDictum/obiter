import type {
  DocumentTextLayout,
  DocumentTextLayoutSegment,
} from '@obiter/contracts'

/**
 * Geometry for overlaying redaction spans on a rendered PDF page.
 * Coordinates are PDF user-space (origin bottom-left), matching pdf.js viewport
 * conversion on the client. `start`/`end` index the extracted document text.
 */
export type { DocumentTextLayout, DocumentTextLayoutSegment }

export interface ExtractedDocumentContent {
  text: string
  layout: DocumentTextLayout | null
}

export interface LaidChar {
  ch: string
  pageIndex: number
  /** Glyph origin on its baseline in PDF user space. */
  x: number
  y: number
  /** The glyph's own drawn advance, never a kerned origin displacement. */
  width: number
  height: number
  ascent: number
  descent: number
  /** Unit writing direction in PDF user space. */
  baselineX: number
  baselineY: number
  /** True when writing and font-height axes are not perpendicular. */
  skewed?: boolean
  /** Non-identity CTM; translation-only Form XObjects still need extra cover bleed. */
  transformed?: boolean
}

/** Same baseline slack as coverRectsForSpan union-merge. */
const BASELINE_MERGE_TOLERANCE = 1.25

function maxWritingDirectionMergeGap(left: LaidChar, right: LaidChar) {
  return Math.max(2.5, Math.min(left.height, right.height) * 0.4)
}

/** Geometry is rounded to keep layout.json small; 0.001pt is far below ink. */
function roundGeometry(value: number) {
  return Math.round(value * 1000) / 1000
}

function displacementAlongBaseline(from: LaidChar, to: LaidChar) {
  return (to.x - from.x) * from.baselineX + (to.y - from.y) * from.baselineY
}

function displacementAcrossBaseline(from: LaidChar, to: LaidChar) {
  return (to.x - from.x) * -from.baselineY + (to.y - from.y) * from.baselineX
}

function sameWritingDirection(left: LaidChar, right: LaidChar) {
  return (
    left.baselineX * right.baselineX + left.baselineY * right.baselineY > 0.999
  )
}

function canMergeIntoRun(previous: LaidChar, next: LaidChar) {
  if (previous.pageIndex !== next.pageIndex) return false
  if (!sameWritingDirection(previous, next)) return false
  if (
    Math.abs(displacementAcrossBaseline(previous, next)) >
    BASELINE_MERGE_TOLERANCE
  )
    return false
  if (previous.height !== next.height) return false
  if (previous.ascent !== next.ascent || previous.descent !== next.descent)
    return false
  const displacement = displacementAlongBaseline(previous, next)
  if (displacement <= 0) return false
  const gap = displacement - previous.width
  return gap <= maxWritingDirectionMergeGap(previous, next)
}

/**
 * Build layout segments, merging contiguous glyphs on the same baseline into
 * runs. Each run records its characters' real advances, so merging costs a few
 * bytes per character instead of a whole segment and coverRectsForSpan still
 * places every character exactly where it was drawn.
 */
function charSegments(chars: LaidChar[]): DocumentTextLayoutSegment[] {
  const segments: DocumentTextLayoutSegment[] = []
  let run: DocumentTextLayoutSegment | null = null
  let runLast: LaidChar | null = null

  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index]
    if (!current || current.ch === '\n') {
      run = null
      runLast = null
      continue
    }

    if (
      run &&
      runLast &&
      run.advances &&
      run.glyphWidthOverrides &&
      canMergeIntoRun(runLast, current)
    ) {
      // Placement and drawn extent are separate: TJ kerning changes the first,
      // but a trailing redaction still needs the glyph's full own advance.
      const previousIndex = run.advances.length - 1
      const placementAdvance = roundGeometry(
        displacementAlongBaseline(runLast, current),
      )
      const glyphWidth = roundGeometry(Math.max(runLast.width, 0.5))
      run.advances[previousIndex] = placementAdvance
      if (placementAdvance !== glyphWidth) {
        run.glyphWidthOverrides[String(previousIndex)] = glyphWidth
      }
      run.advances.push(roundGeometry(Math.max(current.width, 0.5)))
      run.end = index + 1
      const runOrigin = chars[run.start] ?? runLast
      run.width = roundGeometry(
        Math.max(
          displacementAlongBaseline(runOrigin, current) +
            Math.max(current.width, 0.5),
          0.5,
        ),
      )
      runLast = current
      continue
    }

    const rotated =
      Math.abs(current.baselineX - 1) > 0.001 ||
      Math.abs(current.baselineY) > 0.001
    const transformed = rotated || current.transformed === true
    const width = roundGeometry(Math.max(current.width, 0.5))
    run = {
      start: index,
      end: index + 1,
      pageIndex: current.pageIndex,
      x: current.x,
      y: current.y,
      width,
      height: Math.max(current.height, 0.5),
      ascent: current.ascent,
      descent: current.descent,
      advances: [width],
      glyphWidthOverrides: {},
      ...(transformed
        ? {
            baselineX: roundGeometry(current.baselineX),
            baselineY: roundGeometry(current.baselineY),
          }
        : {}),
    }
    runLast = current
    segments.push(run)
  }
  return segments
}

function collapseLineGlyphSpacing(line: string) {
  const collapsedRuns = line.replace(
    /(?<![A-Za-z0-9@._%+-])(?:[A-Za-z0-9@._%+-] ){3,}[A-Za-z0-9@._%+-](?![A-Za-z0-9@._%+-])/g,
    (characters) => characters.replaceAll(' ', ''),
  )
  const tokens = collapsedRuns.trim().split(/\s+/).filter(Boolean)
  let next = collapsedRuns
  if (tokens.length >= 4) {
    const digitTokens = tokens.filter((token) => /^\d+$/u.test(token)).length
    const hasLowerWord = tokens.some(
      (token) => token.length > 1 && /[a-z]/u.test(token),
    )
    const singleLetter = tokens.filter((token) =>
      /^[A-Za-z]$/u.test(token),
    ).length
    const shortUpper = tokens.filter((token) =>
      /^[A-Z0-9]{1,3}$/u.test(token),
    ).length
    if (
      digitTokens < 2 &&
      !hasLowerWord &&
      (singleLetter / tokens.length >= 0.45 ||
        shortUpper / tokens.length >= 0.75)
    ) {
      const leading = /^(\s*)/u.exec(line)?.[1] ?? ''
      const trailing = /(\s*)$/u.exec(line)?.[1] ?? ''
      next = `${leading}${tokens.join('')}${trailing}`
    }
  }
  if (/[a-z]/u.test(next) || !/\s/u.test(next)) return next
  return next.replace(/[A-Z0-9]+(?:\s+[A-Z0-9]{1,3}){2,}/gu, (run) =>
    /\b\d+\b/u.test(run) ? run : run.replace(/\s+/gu, ''),
  )
}

/**
 * Collapse PDF letter-spacing while deleting matching laid characters so
 * offsets stay aligned with stored detection text.
 */
export function collapsePdfGlyphSpacingWithLayout(
  chars: LaidChar[],
): LaidChar[] {
  const lines: LaidChar[][] = [[]]
  for (const laid of chars) {
    if (laid.ch === '\n') {
      lines.push([])
      continue
    }
    lines.at(-1)?.push(laid)
  }

  const result: LaidChar[] = []
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineChars = lines[lineIndex] ?? []
    const line = lineChars.map((item) => item.ch).join('')
    const collapsed = collapseLineGlyphSpacing(line)

    if (collapsed === line) {
      result.push(...lineChars)
    } else {
      let collapsedIndex = 0
      for (const laid of lineChars) {
        if (collapsedIndex >= collapsed.length) break
        if (laid.ch === collapsed[collapsedIndex]) {
          result.push(laid)
          collapsedIndex += 1
          continue
        }
        // Drop the spacing glyph the collapse removed; keep any other mismatch
        // so offsets stay aligned with the surviving characters.
        if (laid.ch === ' ') continue
        result.push(laid)
      }
    }

    if (lineIndex < lines.length - 1) {
      const anchor = lineChars.at(-1) ?? result.at(-1)
      result.push({
        ch: '\n',
        pageIndex: anchor?.pageIndex ?? 0,
        x: anchor?.x ?? 0,
        y: anchor?.y ?? 0,
        width: 0,
        height: anchor?.height ?? 0,
        ascent: anchor?.ascent ?? 0,
        descent: anchor?.descent ?? 0,
        baselineX: anchor?.baselineX ?? 1,
        baselineY: anchor?.baselineY ?? 0,
      })
    }
  }

  return result
}

export function layoutFromLaidChars(
  chars: LaidChar[],
  pages: Array<{ width: number; height: number }>,
): DocumentTextLayout {
  return {
    version: 2,
    pages,
    segments: charSegments(chars),
  }
}
