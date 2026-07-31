import { coverRectsForSpan } from '@obiter/redaction-policy'
import { describe, expect, it } from 'vitest'
import {
  layoutFromLaidChars,
  type DocumentTextLayoutSegment,
  type LaidChar,
} from './document-layout'

function unmergedCharSegments(chars: LaidChar[]): DocumentTextLayoutSegment[] {
  const segments: DocumentTextLayoutSegment[] = []
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index]
    if (!current || current.ch === '\n') continue
    segments.push({
      start: index,
      end: index + 1,
      pageIndex: current.pageIndex,
      x: current.x,
      y: current.y,
      width: Math.max(current.width, 0.5),
      height: Math.max(current.height, 0.5),
      ascent: current.ascent,
      descent: current.descent,
    })
  }
  return segments
}

function lineChars(text: string, startX = 40, baseline = 100): LaidChar[] {
  const glyphWidth = 7
  return [...text].map((ch, index) => ({
    ch,
    pageIndex: 0,
    x: startX + index * glyphWidth,
    y: baseline,
    width: glyphWidth,
    height: 12,
    ascent: 9.6,
    descent: 2.4,
  }))
}

/** Modelled on pushPdfItemChars: glyphWidth = itemWidth / glyphCount. */
function charsFromPdfItems(
  items: Array<{ text: string; x: number; width: number }>,
): LaidChar[] {
  const baseline = 100
  const height = 12
  const ascent = 9.6
  const descent = 2.4
  const chars: LaidChar[] = []
  for (const item of items) {
    const glyphs = [...item.text]
    const glyphWidth = glyphs.length > 0 ? item.width / glyphs.length : 0
    for (let index = 0; index < glyphs.length; index += 1) {
      const ch = glyphs[index]
      if (ch == null) continue
      chars.push({
        ch,
        pageIndex: 0,
        x: item.x + index * glyphWidth,
        y: baseline,
        width: Math.max(glyphWidth, 0.5),
        height,
        ascent,
        descent,
      })
    }
  }
  return chars
}

describe('layoutFromLaidChars', () => {
  it('merges a single-line run into few segments without changing cover geometry', () => {
    const text = 'Alice Smith lives at 12 High Street'
    const chars = lineChars(text)
    const merged = layoutFromLaidChars(chars, [{ width: 400, height: 200 }])
    const unmerged = unmergedCharSegments(chars)

    expect(merged.version).toBe(1)
    expect(merged.segments.length).toBeLessThan(8)
    expect(merged.segments.length).toBeLessThan(unmerged.length / 3)

    const spanStart = text.indexOf('Alice')
    const spanEnd = spanStart + 'Alice'.length
    const spanText = 'Alice'
    const mergedCovers = coverRectsForSpan({
      segments: merged.segments,
      spanStart,
      spanEnd,
      spanText,
    })
    const unmergedCovers = coverRectsForSpan({
      segments: unmerged,
      spanStart,
      spanEnd,
      spanText,
    })

    expect(mergedCovers).toHaveLength(unmergedCovers.length)
    for (let index = 0; index < mergedCovers.length; index += 1) {
      const left = mergedCovers[index]!
      const right = unmergedCovers[index]!
      expect(left.pageIndex).toBe(right.pageIndex)
      expect(left.x).toBeCloseTo(right.x, 1)
      expect(left.y).toBeCloseTo(right.y, 1)
      expect(left.width).toBeCloseTo(right.width, 1)
      expect(left.height).toBeCloseTo(right.height, 1)
    }
  })

  it('does not merge across a horizontal gap large enough to break interpolation', () => {
    const left = lineChars('Alice', 40)
    const right = lineChars('Smith', 200)
    const chars = [...left, ...right]
    const layout = layoutFromLaidChars(chars, [{ width: 400, height: 200 }])
    expect(layout.segments.length).toBeGreaterThanOrEqual(2)
    expect(
      layout.segments.some((segment) => segment.end - segment.start > 1),
    ).toBe(true)
    expect(
      layout.segments.every(
        (segment) => segment.end <= left.length || segment.start >= left.length,
      ),
    ).toBe(true)
  })

  it('keeps cover geometry exact across adjacent items with unequal advances', () => {
    // Two pdf.js items on one baseline, different average advances (kerning /
    // disableCombineTextItems). Pre-fix merge collapsed both into 1 segment;
    // width equality keeps 2 (one per item) while still merging within each.
    const prefix = 'Mr. '
    const name = 'Wilhelmina'
    const prefixAdvance = 4.5
    const nameAdvance = 7.2
    const startX = 40
    const chars = charsFromPdfItems([
      { text: prefix, x: startX, width: prefix.length * prefixAdvance },
      {
        text: name,
        x: startX + prefix.length * prefixAdvance,
        width: name.length * nameAdvance,
      },
    ])
    const merged = layoutFromLaidChars(chars, [{ width: 400, height: 200 }])
    const unmerged = unmergedCharSegments(chars)

    expect(merged.segments.length).toBe(2)
    expect(merged.segments[0]!.end - merged.segments[0]!.start).toBe(
      prefix.length,
    )
    expect(merged.segments[1]!.end - merged.segments[1]!.start).toBe(
      name.length,
    )

    const spanStart = prefix.length
    const spanEnd = prefix.length + name.length
    const spanText = name
    const mergedCovers = coverRectsForSpan({
      segments: merged.segments,
      spanStart,
      spanEnd,
      spanText,
    })
    const unmergedCovers = coverRectsForSpan({
      segments: unmerged,
      spanStart,
      spanEnd,
      spanText,
    })

    expect(mergedCovers).toHaveLength(unmergedCovers.length)
    for (let index = 0; index < mergedCovers.length; index += 1) {
      const left = mergedCovers[index]!
      const right = unmergedCovers[index]!
      expect(left.pageIndex).toBe(right.pageIndex)
      expect(left.x).toBeCloseTo(right.x, 1)
      expect(left.y).toBeCloseTo(right.y, 1)
      expect(left.width).toBeCloseTo(right.width, 1)
      expect(left.height).toBeCloseTo(right.height, 1)
    }

    const trueFirstX = chars[spanStart]!.x
    expect(mergedCovers[0]!.x).toBeLessThanOrEqual(trueFirstX)
  })
})
