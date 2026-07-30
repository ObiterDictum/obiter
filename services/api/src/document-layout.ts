/**
 * Geometry for overlaying redaction spans on a rendered PDF page.
 * Coordinates are PDF user-space (origin bottom-left), matching pdf.js viewport
 * conversion on the client. `start`/`end` index the extracted document text.
 */
export interface DocumentTextLayoutSegment {
  start: number
  end: number
  pageIndex: number
  x: number
  y: number
  width: number
  /** Em / font size from the text matrix. */
  height: number
  /** Distance above the baseline to the font ascent line (PDF units). */
  ascent?: number
  /** Distance below the baseline to the font descent line (PDF units). */
  descent?: number
}

export interface DocumentTextLayout {
  version: 1
  pages: Array<{ width: number; height: number }>
  segments: DocumentTextLayoutSegment[]
}

export interface ExtractedDocumentContent {
  text: string
  layout: DocumentTextLayout | null
}

export interface LaidChar {
  ch: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  ascent: number
  descent: number
}

/** Same baseline slack as coverRectsForSpan union-merge. */
const BASELINE_MERGE_TOLERANCE = 1.25

function maxHorizontalMergeGap(left: LaidChar, right: LaidChar) {
  // Keep runs tight enough that mid-span interpolation stays near real glyphs.
  return Math.max(2.5, Math.min(left.height, right.height) * 0.4)
}

function canMergeIntoRun(previous: LaidChar, next: LaidChar) {
  if (previous.pageIndex !== next.pageIndex) return false
  if (Math.abs(previous.y - next.y) > BASELINE_MERGE_TOLERANCE) return false
  if (previous.height !== next.height) return false
  if (previous.ascent !== next.ascent || previous.descent !== next.descent)
    return false
  const gap = next.x - (previous.x + previous.width)
  return gap <= maxHorizontalMergeGap(previous, next)
}

/**
 * Build layout segments, merging contiguous glyphs on the same baseline into
 * runs. coverRectsForSpan interpolates within multi-character segments, so
 * merged and unmerged layouts stay equivalent for cover geometry.
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

    if (run && runLast && canMergeIntoRun(runLast, current)) {
      run.end = index + 1
      run.width = Math.max(current.x + Math.max(current.width, 0.5) - run.x, 0.5)
      runLast = current
      continue
    }

    run = {
      start: index,
      end: index + 1,
      pageIndex: current.pageIndex,
      x: current.x,
      y: current.y,
      width: Math.max(current.width, 0.5),
      height: Math.max(current.height, 0.5),
      ascent: current.ascent,
      descent: current.descent,
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
export function collapsePdfGlyphSpacingWithLayout(chars: LaidChar[]): LaidChar[] {
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
    version: 1,
    pages,
    segments: charSegments(chars),
  }
}
