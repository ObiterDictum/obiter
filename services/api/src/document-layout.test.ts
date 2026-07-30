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
    expect(layout.segments.some((segment) => segment.end - segment.start > 1)).toBe(
      true,
    )
    expect(
      layout.segments.every(
        (segment) =>
          segment.end <= left.length || segment.start >= left.length,
      ),
    ).toBe(true)
  })
})
