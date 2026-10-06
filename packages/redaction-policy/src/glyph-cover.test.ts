import { describe, expect, it } from 'bun:test'
import {
  coverRectsForSpan,
  glyphCoverRect,
  snapDeviceCoverOutward,
} from './glyph-cover'

describe('glyphCoverRect', () => {
  it('uses font ascent/descent when provided', () => {
    const covered = glyphCoverRect({
      x: 40,
      y: 100,
      width: 50,
      fontSize: 20,
      ink: 'Karl',
      ascent: 20 * 0.718,
      descent: 20 * 0.207,
    })
    const slack = 20 * 0.08
    expect(covered.y + covered.height).toBeCloseTo(100 + 20 * 0.718 + slack, 5)
    expect(100 - covered.y).toBeCloseTo(20 * 0.207 + slack, 5)
  })

  it('deepens descent for J beyond the font descent line', () => {
    const jones = glyphCoverRect({
      x: 40,
      y: 100,
      width: 12,
      fontSize: 20,
      ink: 'J',
      ascent: 14,
      descent: 4,
    })
    expect(100 - jones.y).toBeGreaterThan(4 + 20 * 0.08)
    expect(jones.x).toBeLessThan(40)
  })
})

describe('snapDeviceCoverOutward', () => {
  it('floors min edges and ceils max edges', () => {
    expect(
      snapDeviceCoverOutward({
        left: 579.768,
        right: 609.048,
        top: 929.136,
        bottom: 986.88,
      }),
    ).toEqual({ left: 579, right: 610, top: 929, bottom: 987 })
  })
})

describe('coverRectsForSpan', () => {
  it('keeps J in the Jones bar using per-glyph font metrics', () => {
    const fontSize = 20
    const baseline = 200
    const ascent = fontSize * 0.72
    const descent = fontSize * 0.21
    const letters = [...'Jones']
    let x = 40
    const segments = letters.map((ch, index) => {
      const width = ch === 'J' ? 12 : 10
      const segment = {
        start: index,
        end: index + 1,
        pageIndex: 0,
        x,
        y: baseline,
        width,
        height: fontSize,
        ascent,
        descent,
      }
      x += width
      return segment
    })

    const covers = coverRectsForSpan({
      segments,
      spanStart: 0,
      spanEnd: 5,
      spanText: 'Jones',
    })

    expect(covers).toHaveLength(1)
    expect(covers[0]!.ink).toBe('Jones')
    expect(covers[0]!.x).toBeLessThanOrEqual(40)
    expect(baseline - covers[0]!.y).toBeGreaterThan(descent)
  })

  it('drops non-finite segment geometry instead of returning NaN rects', () => {
    const covers = coverRectsForSpan({
      segments: [
        {
          start: 0,
          end: 2,
          pageIndex: 0,
          x: 40,
          y: 100,
          width: 20,
          height: 20,
          advances: [Number.NaN, 10],
          glyphWidthOverrides: {},
        },
      ],
      spanStart: 0,
      spanEnd: 1,
      spanText: 'A',
    })

    expect(covers).toEqual([])
  })

  it('uses interpolation for legacy segments whose advances lack width overrides', () => {
    const covers = coverRectsForSpan({
      segments: [
        {
          start: 0,
          end: 2,
          pageIndex: 0,
          x: 40,
          y: 100,
          width: 20,
          height: 20,
          // Version 1 used these values for both placement and extent. Without
          // the v2 override marker they must not enter the exact path.
          advances: [4, 10],
        },
      ],
      spanStart: 1,
      spanEnd: 2,
      spanText: 'B',
    })

    expect(covers).toHaveLength(1)
    expect(covers[0]!.x).toBeCloseTo(49.2, 5)
  })

  it('merges across a wide whitespace gap only when source adjacency is proven', () => {
    // 'A B': glyphs at 40 and 60 with a 10pt gap, wider than the single-span
    // threshold. Only a coalesced-region caller may bridge it.
    const segments = [
      { start: 0, end: 1, pageIndex: 0, x: 40, y: 100, width: 10, height: 12 },
      { start: 2, end: 3, pageIndex: 0, x: 60, y: 100, width: 10, height: 12 },
    ]
    const base = { segments, spanStart: 0, spanEnd: 3, spanText: 'A B' }
    expect(coverRectsForSpan(base)).toHaveLength(2)
    const merged = coverRectsForSpan({ ...base, mergeWhitespace: true })
    expect(merged).toHaveLength(1)
    expect(merged[0]!.width).toBeGreaterThan(25)
  })

  it('does not merge a deep J into a word on its left', () => {
    const fontSize = 16
    const baseline = 100
    const segments = [
      ...[...'Karl'].map((ch, index) => ({
        start: index,
        end: index + 1,
        pageIndex: 0,
        x: 10 + index * 9,
        y: baseline,
        width: 8,
        height: fontSize,
        ascent: 12,
        descent: 3,
      })),
      ...[...'Jones'].map((ch, index) => ({
        start: 5 + index,
        end: 6 + index,
        pageIndex: 0,
        x: 60 + index * 10,
        y: baseline,
        width: ch === 'J' ? 11 : 9,
        height: fontSize,
        ascent: 12,
        descent: 3,
      })),
    ]

    const karl = coverRectsForSpan({
      segments,
      spanStart: 0,
      spanEnd: 4,
      spanText: 'Karl',
    })
    const jones = coverRectsForSpan({
      segments,
      spanStart: 5,
      spanEnd: 10,
      spanText: 'Jones',
    })

    expect(karl[0]!.ink).toBe('Karl')
    expect(jones[0]!.ink).toBe('Jones')
    expect(jones[0]!.x).toBeLessThanOrEqual(60)
    expect(karl[0]!.x + karl[0]!.width).toBeLessThan(jones[0]!.x + 1)
  })
})

describe('coverRectsForSpan whitespace merge bound', () => {
  const segment = (
    start: number,
    end: number,
    x: number,
    width: number,
    extra: Record<string, number> = {},
  ) => ({ start, end, pageIndex: 0, x, y: 100, width, height: 12, ...extra })

  const planned = (segments: ReturnType<typeof segment>[], spanText: string) =>
    coverRectsForSpan({
      segments,
      spanStart: 0,
      spanEnd: spanText.length,
      spanText,
      mergeWhitespace: true,
    })

  it('merges three adjacent accepted words into one bar', () => {
    const result = planned(
      [segment(0, 4, 40, 25), segment(5, 12, 68, 45), segment(13, 18, 116, 30)],
      'John Michael Smith',
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.x).toBeLessThanOrEqual(40)
    expect(result[0]!.x + result[0]!.width).toBeGreaterThanOrEqual(146)
  })

  it('still merges a multi-space gap wider than one space', () => {
    // Two spaces at 12pt: a 10pt gap, inside the two-em bound.
    expect(
      planned([segment(0, 1, 40, 10), segment(3, 4, 60, 10)], 'A  B'),
    ).toHaveLength(1)
  })

  it('does not bridge the reproduced 260pt same-baseline gap', () => {
    // The review's adversarial layout: glyphs 260pt apart, source 'A B'.
    expect(
      planned([segment(0, 1, 40, 10), segment(2, 3, 310, 10)], 'A B'),
    ).toHaveLength(2)
  })

  it('does not bridge a same-baseline two-column gap', () => {
    expect(
      planned([segment(0, 1, 40, 40), segment(2, 3, 200, 40)], 'A B'),
    ).toHaveLength(2)
  })

  it('does not bridge a same-baseline table gutter beyond word spacing', () => {
    // A 30pt gutter at 12pt text: wider than the two-em bound, so it splits.
    expect(
      planned([segment(0, 1, 40, 10), segment(2, 3, 80, 10)], 'A B'),
    ).toHaveLength(2)
  })

  it('keeps a wrapped region as one bar per rendered line', () => {
    expect(
      planned([segment(0, 1, 40, 10), segment(2, 3, 40, 10, { y: 80 })], 'A B'),
    ).toHaveLength(2)
  })

  it('does not merge across pages or opposing writing directions', () => {
    expect(
      planned(
        [segment(0, 1, 40, 10), segment(2, 3, 42, 10, { pageIndex: 1 })],
        'A B',
      ),
    ).toHaveLength(2)
    expect(
      planned(
        [segment(0, 1, 40, 10), segment(2, 3, 42, 10, { baselineX: -1 })],
        'A B',
      ),
    ).toHaveLength(2)
  })
})
