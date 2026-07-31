import { describe, expect, it } from 'vitest'
import { coverRectsForSpan, glyphCoverRect } from './glyph-cover'

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
