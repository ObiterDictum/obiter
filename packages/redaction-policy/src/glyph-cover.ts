/**
 * Map redaction spans onto PDF glyph geometry.
 *
 * Layout `y` is the text baseline (PDF user space, origin bottom-left).
 * Prefer font ascent/descent captured at extraction; fall back to em heuristics.
 */

/** Ink that often exceeds the font descent line. */
const DEEP_DESCENDER = /[gjpqyQJ]/u

export interface GlyphCoverInput {
  x: number
  /** Glyph baseline in PDF user space. */
  y: number
  width: number
  /** Em size (from the text matrix / pdf.js item height). */
  fontSize: number
  /** Characters this rect covers — selects extra descender slack. */
  ink?: string
  /** Font ascent above baseline (PDF units), from pdf.js styles. */
  ascent?: number
  /** Font descent below baseline (PDF units, positive), from pdf.js styles. */
  descent?: number
}

export interface GlyphCoverRect {
  x: number
  /** Bottom edge in PDF user space. */
  y: number
  width: number
  height: number
}

export interface LayoutSegmentLike {
  start: number
  end: number
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  ascent?: number
  descent?: number
}

type TrackedGlyph = GlyphCoverRect & {
  pageIndex: number
  ink: string
  baseline: number
}

/**
 * Cover one glyph using font metrics when available.
 */
export function glyphCoverRect(input: GlyphCoverInput): GlyphCoverRect {
  const fontSize = Math.max(input.fontSize, 4)
  const ink = input.ink ?? ''
  // Small slack covers anti-aliasing and faces that draw outside the em box.
  const slack = fontSize * 0.08
  const ascent = (input.ascent ?? fontSize * 0.8) + slack
  const fontDescent = input.descent ?? fontSize * 0.2
  const descent =
    Math.max(fontDescent, DEEP_DESCENDER.test(ink) ? fontSize * 0.34 : 0) +
    slack
  const padLeft = fontSize * (DEEP_DESCENDER.test(ink) ? 0.22 : 0.04)
  const padRight = fontSize * 0.04
  return {
    x: input.x - padLeft,
    y: input.y - descent,
    width: Math.max(input.width, 0.5) + padLeft + padRight,
    height: ascent + descent,
  }
}

/**
 * Build cover rects for a span by mapping each overlapping layout character,
 * then union-merging neighbours on the same baseline (left → right).
 */
export function coverRectsForSpan(input: {
  segments: LayoutSegmentLike[]
  spanStart: number
  spanEnd: number
  spanText: string
}): Array<GlyphCoverRect & { pageIndex: number; ink: string }> {
  const glyphs: TrackedGlyph[] = []

  for (const segment of input.segments) {
    if (segment.end <= input.spanStart || segment.start >= input.spanEnd)
      continue
    const segmentLength = segment.end - segment.start
    if (segmentLength <= 0) continue

    for (
      let index = Math.max(segment.start, input.spanStart);
      index < Math.min(segment.end, input.spanEnd);
      index += 1
    ) {
      const local = index - segment.start
      const startRatio = local / segmentLength
      const endRatio = (local + 1) / segmentLength
      const x =
        segmentLength === 1
          ? segment.x
          : segment.x + segment.width * startRatio
      const width =
        segmentLength === 1
          ? segment.width
          : Math.max(segment.width * (endRatio - startRatio), 0.5)
      const ink = input.spanText[index - input.spanStart] ?? ''
      if (!ink || /\s/u.test(ink)) continue
      glyphs.push({
        ...glyphCoverRect({
          x,
          y: segment.y,
          width,
          fontSize: segment.height,
          ink,
          ascent: segment.ascent,
          descent: segment.descent,
        }),
        pageIndex: segment.pageIndex,
        ink,
        baseline: segment.y,
      })
    }
  }

  return unionMergeGlyphs(glyphs).map(
    ({ baseline: _baseline, ...cover }) => cover,
  )
}

function unionMergeGlyphs(glyphs: TrackedGlyph[]): TrackedGlyph[] {
  if (glyphs.length <= 1) return glyphs
  const sorted = [...glyphs].sort(
    (left, right) =>
      left.pageIndex - right.pageIndex ||
      left.baseline - right.baseline ||
      left.x - right.x,
  )
  const merged: TrackedGlyph[] = []
  for (const glyph of sorted) {
    const previous = merged.at(-1)
    const gap = previous
      ? glyph.x - (previous.x + previous.width)
      : Number.POSITIVE_INFINITY
    const maxGap = Math.max(
      2.5,
      Math.min(previous?.height ?? 0, glyph.height) * 0.4,
    )
    const sameLine =
      previous &&
      previous.pageIndex === glyph.pageIndex &&
      Math.abs(previous.baseline - glyph.baseline) <= 1.25 &&
      glyph.x + glyph.width / 2 >= previous.x &&
      gap <= maxGap

    if (previous && sameLine) {
      const right = Math.max(previous.x + previous.width, glyph.x + glyph.width)
      const top = Math.max(
        previous.y + previous.height,
        glyph.y + glyph.height,
      )
      const bottom = Math.min(previous.y, glyph.y)
      previous.x = Math.min(previous.x, glyph.x)
      previous.y = bottom
      previous.width = right - previous.x
      previous.height = top - bottom
      previous.ink = `${previous.ink}${glyph.ink}`
      continue
    }
    merged.push({ ...glyph })
  }
  return merged
}
