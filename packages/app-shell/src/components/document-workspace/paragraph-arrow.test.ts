import { describe, expect, it } from 'vitest'
import { wrapLines, type WrappedLine } from '../../document-page-flow'
import {
  armVerticalDelivery,
  clearVerticalColumn,
  consumeVerticalDelivery,
  createVerticalCaretColumn,
  isVerticalDelivery,
  offsetAfterArrow,
  offsetVertically,
  retainVerticalColumn,
  visualColumn,
} from './paragraph-arrow'

const lines = (...spans: Array<[number, number]>): WrappedLine[] =>
  spans.map(([from, to]) => ({ text: 'x'.repeat(to - from), from, to }))

describe('visualColumn', () => {
  it('reads the column within the wrapping line that holds the offset', () => {
    const wrapped = lines([0, 10], [10, 13])
    expect(visualColumn(wrapped, 0)).toBe(0)
    expect(visualColumn(wrapped, 7)).toBe(7)
    expect(visualColumn(wrapped, 10)).toBe(0)
    expect(visualColumn(wrapped, 12)).toBe(2)
  })

  it('clamps a gap between lines, as an explicit newline leaves', () => {
    // from/to exclude the newline, so offset 10 sits in the gap before line 1
    const wrapped = lines([0, 10], [11, 20])
    expect(visualColumn(wrapped, 10)).toBe(0)
  })

  it('counts UTF-16 code units, matching the model offsets', () => {
    const text = 'a\u{1D11E}b'
    const wrapped = wrapLines(text, 16, 10_000)
    expect(text.length).toBe(4)
    expect(wrapped[0]?.to).toBe(4)
    expect(visualColumn(wrapped, 3)).toBe(3)
  })
})

describe('offsetVertically', () => {
  const wrapped = lines([0, 20], [20, 30], [30, 40])

  it('lands on the adjacent line at the retained column', () => {
    expect(
      offsetVertically({
        key: 'ArrowDown',
        offset: 5,
        lines: wrapped,
        column: 5,
      }),
    ).toBe(25)
    expect(
      offsetVertically({
        key: 'ArrowUp',
        offset: 25,
        lines: wrapped,
        column: 5,
      }),
    ).toBe(5)
  })

  it('clamps the caret on a shorter destination line', () => {
    expect(
      offsetVertically({
        key: 'ArrowDown',
        offset: 5,
        lines: wrapped,
        column: 18,
      }),
    ).toBe(30)
  })

  it('returns undefined at the ends of the wrapping', () => {
    expect(
      offsetVertically({
        key: 'ArrowUp',
        offset: 5,
        lines: wrapped,
        column: 5,
      }),
    ).toBeUndefined()
    expect(
      offsetVertically({
        key: 'ArrowDown',
        offset: 35,
        lines: wrapped,
        column: 5,
      }),
    ).toBeUndefined()
  })

  it('returns undefined inside a single empty line', () => {
    const empty = lines([0, 0])
    expect(
      offsetVertically({
        key: 'ArrowDown',
        offset: 0,
        lines: empty,
        column: 0,
      }),
    ).toBeUndefined()
  })
})

describe('offsetAfterArrow', () => {
  const next = { id: 'n', text: 'x'.repeat(60), lines: lines([0, 60]) }
  const shortPrevious = {
    id: 'p',
    text: 'x'.repeat(25),
    lines: lines([0, 20], [20, 25]),
  }

  it('uses the supplied column rather than the caret offset', () => {
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 10,
        text: 'x'.repeat(60),
        lines: lines([0, 60]),
        column: 40,
        next,
      }),
    ).toEqual({ paragraphId: 'n', offset: 40 })
    expect(
      offsetAfterArrow({
        key: 'ArrowDown',
        offset: 10,
        text: 'x'.repeat(60),
        lines: lines([0, 60]),
        column: 10,
        next,
      }),
    ).toEqual({ paragraphId: 'n', offset: 10 })
  })

  it('clamps against a short previous line and keeps the column above it', () => {
    expect(
      offsetAfterArrow({
        key: 'ArrowUp',
        offset: 0,
        text: 'short',
        lines: lines([0, 5]),
        column: 40,
        previous: shortPrevious,
      }),
    ).toEqual({ paragraphId: 'p', offset: 25 })
  })

  it('keeps plain Left/Right boundary crossing unchanged', () => {
    expect(
      offsetAfterArrow({
        key: 'ArrowLeft',
        offset: 0,
        text: 'abc',
        lines: lines([0, 3]),
        column: 0,
        previous: shortPrevious,
      }),
    ).toEqual({ paragraphId: 'p', offset: 25 })
    expect(
      offsetAfterArrow({
        key: 'ArrowRight',
        offset: 3,
        text: 'abc',
        lines: lines([0, 3]),
        column: 0,
        next,
      }),
    ).toEqual({ paragraphId: 'n', offset: 0 })
  })
})

describe('retainVerticalColumn', () => {
  it('establishes the column once and keeps it across a clamp', () => {
    const state = createVerticalCaretColumn()
    expect(retainVerticalColumn(state, lines([0, 60]), 40)).toBe(40)
    expect(retainVerticalColumn(state, lines([0, 10]), 10)).toBe(40)
    clearVerticalColumn(state)
    expect(retainVerticalColumn(state, lines([0, 10]), 10)).toBe(10)
  })

  it('reads a fresh column when no run state is owned', () => {
    expect(retainVerticalColumn(undefined, lines([0, 60]), 40)).toBe(40)
  })
})

describe('vertical caret delivery', () => {
  it('consumes once, and only for the paragraph the move armed', () => {
    const state = createVerticalCaretColumn()
    armVerticalDelivery(state, { paragraphId: 'p2', offset: 40 })
    expect(consumeVerticalDelivery(state, 'p2')).toBe(true)
    expect(consumeVerticalDelivery(state, 'p2')).toBe(false)
  })

  it('does not let another paragraph consume the armed delivery', () => {
    const state = createVerticalCaretColumn()
    armVerticalDelivery(state, { paragraphId: 'p2', offset: 40 })
    expect(consumeVerticalDelivery(state, 'p3')).toBe(false)
    // The mismatch spent the transition, so the intended destination cannot
    // pick it up later either.
    expect(consumeVerticalDelivery(state, 'p2')).toBe(false)
  })

  it('treats only an exact paragraph/offset transition as the delivery', () => {
    const state = createVerticalCaretColumn()
    armVerticalDelivery(state, { paragraphId: 'p2', offset: 40 })
    expect(isVerticalDelivery(state, { paragraphId: 'p2', offset: 40 })).toBe(
      true,
    )
    expect(isVerticalDelivery(state, { paragraphId: 'p2', offset: 5 })).toBe(
      false,
    )
    expect(isVerticalDelivery(state, { paragraphId: 'p3', offset: 40 })).toBe(
      false,
    )
  })

  it('arms nothing when no run state is owned', () => {
    expect(() =>
      armVerticalDelivery(undefined, { paragraphId: 'p2', offset: 0 }),
    ).not.toThrow()
    expect(consumeVerticalDelivery(undefined, 'p2')).toBe(false)
  })

  it('clears a pending delivery with the column', () => {
    const state = createVerticalCaretColumn()
    retainVerticalColumn(state, lines([0, 60]), 40)
    armVerticalDelivery(state, { paragraphId: 'p2', offset: 40 })
    clearVerticalColumn(state)
    expect(state.column).toBeNull()
    expect(state.pending).toBeNull()
    expect(consumeVerticalDelivery(state, 'p2')).toBe(false)
  })
})
