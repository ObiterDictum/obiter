import type { DocumentTextLayoutSegment } from '@obiter/contracts'

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
  /** Unit writing direction; defaults to ordinary left-to-right text. */
  baselineX?: number
  baselineY?: number
}

export interface GlyphCoverRect {
  x: number
  /** Bottom edge in PDF user space. */
  y: number
  width: number
  height: number
}

export type LayoutSegmentLike = DocumentTextLayoutSegment

type TrackedGlyph = GlyphCoverRect & {
  pageIndex: number
  ink: string
  baseline: number
  along: number
  advanceWidth: number
  baselineX: number
  baselineY: number
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
  const magnitude = Math.hypot(input.baselineX ?? 1, input.baselineY ?? 0) || 1
  const baselineX = (input.baselineX ?? 1) / magnitude
  const baselineY = (input.baselineY ?? 0) / magnitude
  // Rasterizers disagree slightly at transformed edge pixels. Add conservative
  // writing-direction slack so rotated covers contain anti-aliased edge ink.
  const transformedSlack =
    Math.abs(baselineX - 1) > 0.001 || Math.abs(baselineY) > 0.001
      ? fontSize * 0.02
      : 0
  const padLeft =
    fontSize * (DEEP_DESCENDER.test(ink) ? 0.22 : 0.04) + transformedSlack
  const padRight = fontSize * 0.04 + transformedSlack
  const normalX = -baselineY
  const normalY = baselineX
  const alongStart = -padLeft
  const alongEnd = Math.max(input.width, 0.5) + padRight
  const acrossStart = -descent
  const acrossEnd = ascent
  const corners = [
    [alongStart, acrossStart],
    [alongStart, acrossEnd],
    [alongEnd, acrossStart],
    [alongEnd, acrossEnd],
  ].map(([along = 0, across = 0]) => ({
    x: input.x + along * baselineX + across * normalX,
    y: input.y + along * baselineY + across * normalY,
  }))
  const left = Math.min(...corners.map((corner) => corner.x))
  const right = Math.max(...corners.map((corner) => corner.x))
  const bottom = Math.min(...corners.map((corner) => corner.y))
  const top = Math.max(...corners.map((corner) => corner.y))
  return {
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
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
    if (!hasFiniteSegmentGeometry(segment)) continue
    if (segment.end <= input.spanStart || segment.start >= input.spanEnd)
      continue
    const segmentLength = segment.end - segment.start
    if (segmentLength <= 0) continue
    const placementOffsets = exactPlacementOffsets(segment)

    for (
      let index = Math.max(segment.start, input.spanStart);
      index < Math.min(segment.end, input.spanEnd);
      index += 1
    ) {
      const local = index - segment.start
      const exact = exactPlacement(segment, local, placementOffsets)
      const startRatio = local / segmentLength
      const endRatio = (local + 1) / segmentLength
      const x =
        exact?.x ??
        (segmentLength === 1
          ? segment.x
          : segment.x + segment.width * startRatio)
      const y = exact?.y ?? segment.y
      const width =
        exact?.width ??
        (segmentLength === 1
          ? segment.width
          : Math.max(segment.width * (endRatio - startRatio), 0.5))
      const rawBaselineX = exact?.baselineX ?? segment.baselineX ?? 1
      const rawBaselineY = exact?.baselineY ?? segment.baselineY ?? 0
      const baselineMagnitude = Math.hypot(rawBaselineX, rawBaselineY) || 1
      const baselineX = rawBaselineX / baselineMagnitude
      const baselineY = rawBaselineY / baselineMagnitude
      const normalX = -baselineY
      const normalY = baselineX
      const ink = input.spanText[index - input.spanStart] ?? ''
      if (!ink || /\s/u.test(ink)) continue
      glyphs.push({
        ...glyphCoverRect({
          x,
          y,
          width,
          fontSize: segment.height,
          ink,
          ascent: segment.ascent,
          descent: segment.descent,
          baselineX,
          baselineY,
        }),
        pageIndex: segment.pageIndex,
        ink,
        baseline: x * normalX + y * normalY,
        along: x * baselineX + y * baselineY,
        advanceWidth: width,
        baselineX,
        baselineY,
      })
    }
  }

  return unionMergeGlyphs(glyphs).map(
    ({
      baseline: _baseline,
      along: _along,
      advanceWidth: _advanceWidth,
      baselineX: _baselineX,
      baselineY: _baselineY,
      ...cover
    }) => cover,
  )
}

function hasFiniteSegmentGeometry(segment: LayoutSegmentLike) {
  const values = [
    segment.start,
    segment.end,
    segment.pageIndex,
    segment.x,
    segment.y,
    segment.width,
    segment.height,
    segment.ascent,
    segment.descent,
    segment.baselineX,
    segment.baselineY,
    ...(segment.advances ?? []),
    ...Object.values(segment.glyphWidthOverrides ?? {}),
  ]
  return values.every((value) => value === undefined || Number.isFinite(value))
}

/**
 * Where a character actually sits, when extraction recorded real advances.
 * Interpolating instead can leave part of a redacted word outside its bar.
 */
function exactPlacementOffsets(segment: LayoutSegmentLike) {
  const advances = segment.advances
  if (!advances || advances.length !== segment.end - segment.start) return null
  const offsets = [0]
  for (const advance of advances) {
    offsets.push((offsets.at(-1) ?? 0) + advance)
  }
  return offsets
}

function exactPlacement(
  segment: LayoutSegmentLike,
  local: number,
  offsets: number[] | null,
) {
  const advances = segment.advances
  const glyphWidthOverrides = segment.glyphWidthOverrides
  if (!advances || !glyphWidthOverrides || !offsets) return null
  const ownWidth = glyphWidthOverrides[String(local)] ?? advances[local]
  const offset = offsets[local]
  if (typeof ownWidth !== 'number' || typeof offset !== 'number') return null
  const baselineMagnitude =
    Math.hypot(segment.baselineX ?? 1, segment.baselineY ?? 0) || 1
  const baselineX = (segment.baselineX ?? 1) / baselineMagnitude
  const baselineY = (segment.baselineY ?? 0) / baselineMagnitude
  return {
    x: segment.x + offset * baselineX,
    y: segment.y + offset * baselineY,
    width: Math.max(ownWidth, 0.5),
    baselineX,
    baselineY,
  }
}

function unionMergeGlyphs(glyphs: TrackedGlyph[]): TrackedGlyph[] {
  if (glyphs.length <= 1) return glyphs
  const sorted = [...glyphs].sort(
    (left, right) =>
      left.pageIndex - right.pageIndex ||
      left.baseline - right.baseline ||
      left.along - right.along,
  )
  const merged: TrackedGlyph[] = []
  for (const glyph of sorted) {
    const previous = merged.at(-1)
    const gap = previous
      ? glyph.along - (previous.along + previous.advanceWidth)
      : Number.POSITIVE_INFINITY
    const maxGap = Math.max(
      2.5,
      Math.min(previous?.height ?? 0, glyph.height) * 0.4,
    )
    const directionMatch = previous
      ? previous.baselineX * glyph.baselineX +
        previous.baselineY * glyph.baselineY
      : 0
    const sameLine =
      previous &&
      previous.pageIndex === glyph.pageIndex &&
      directionMatch > 0.999 &&
      Math.abs(previous.baseline - glyph.baseline) <= 1.25 &&
      glyph.along + glyph.advanceWidth / 2 >= previous.along &&
      gap <= maxGap

    if (previous && sameLine) {
      const right = Math.max(previous.x + previous.width, glyph.x + glyph.width)
      const top = Math.max(previous.y + previous.height, glyph.y + glyph.height)
      const bottom = Math.min(previous.y, glyph.y)
      previous.x = Math.min(previous.x, glyph.x)
      previous.y = bottom
      previous.width = right - previous.x
      previous.height = top - bottom
      const advanceEnd = Math.max(
        previous.along + previous.advanceWidth,
        glyph.along + glyph.advanceWidth,
      )
      previous.along = Math.min(previous.along, glyph.along)
      previous.advanceWidth = advanceEnd - previous.along
      previous.ink = `${previous.ink}${glyph.ink}`
      continue
    }
    merged.push({ ...glyph })
  }
  return merged
}
