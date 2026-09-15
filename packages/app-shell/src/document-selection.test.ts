import { describe, expect, it } from 'vitest'
import type { WrappedLine } from './document-page-flow'
import {
  compareEndpoints,
  orderedSelection,
  reconcileSelection,
  selectionCollapsed,
  selectionDirection,
  selectionPlainText,
  selectionSegmentMap,
  selectionSegments,
  stepSelectionFocus,
  wholeDocumentSelection,
  type DocumentSelection,
  type SelectionOrder,
} from './document-selection'

const lines = (...spans: Array<[number, number]>): WrappedLine[] =>
  spans.map(([from, to]) => ({ text: 'x'.repeat(to - from), from, to }))

function order(texts: Record<string, string>): SelectionOrder {
  const ids = Object.keys(texts)
  return { order: ids, textOf: (id) => texts[id] ?? '' }
}

function selection(
  anchor: { paragraphId: string; offset: number },
  focus: { paragraphId: string; offset: number },
): DocumentSelection {
  return { anchor, focus }
}

describe('selection endpoints and direction', () => {
  const context = order({ p1: 'alpha', p2: 'bravo', p3: 'charlie' })

  it('orders endpoints by paragraph flow, then by offset inside a paragraph', () => {
    expect(
      compareEndpoints(
        context.order,
        { paragraphId: 'p1', offset: 4 },
        { paragraphId: 'p2', offset: 0 },
      ),
    ).toBe(-1)
    expect(
      compareEndpoints(
        context.order,
        { paragraphId: 'p2', offset: 3 },
        { paragraphId: 'p2', offset: 1 },
      ),
    ).toBe(1)
    expect(
      compareEndpoints(
        context.order,
        { paragraphId: 'p2', offset: 3 },
        { paragraphId: 'p2', offset: 3 },
      ),
    ).toBe(0)
  })

  it('reports the direction and the earlier endpoint', () => {
    const forward = selection(
      { paragraphId: 'p1', offset: 2 },
      { paragraphId: 'p3', offset: 4 },
    )
    expect(selectionDirection(context.order, forward)).toBe('forward')
    expect(orderedSelection(context.order, forward)).toEqual({
      start: { paragraphId: 'p1', offset: 2 },
      end: { paragraphId: 'p3', offset: 4 },
    })

    const backward = selection(
      { paragraphId: 'p3', offset: 4 },
      { paragraphId: 'p1', offset: 2 },
    )
    expect(selectionDirection(context.order, backward)).toBe('backward')
    expect(orderedSelection(context.order, backward).start.paragraphId).toBe(
      'p1',
    )
    expect(selectionDirection(context.order, selection(
      { paragraphId: 'p2', offset: 2 },
      { paragraphId: 'p2', offset: 2 },
    ))).toBe('none')
    expect(
      selectionCollapsed(
        selection(
          { paragraphId: 'p2', offset: 2 },
          { paragraphId: 'p2', offset: 2 },
        ),
      ),
    ).toBe(true)
  })
})

describe('selected segments', () => {
  it('has no segments for a collapsed selection', () => {
    const context = order({ p1: 'alpha', p2: 'bravo' })
    expect(
      selectionSegments(
        context,
        selection(
          { paragraphId: 'p1', offset: 2 },
          { paragraphId: 'p1', offset: 2 },
        ),
      ),
    ).toEqual([])
  })

  it('splits a multi-paragraph selection at both endpoints', () => {
    const context = order({ p1: 'alpha', p2: 'bravo', p3: 'charlie' })
    expect(
      selectionSegments(
        context,
        selection(
          { paragraphId: 'p1', offset: 3 },
          { paragraphId: 'p3', offset: 2 },
        ),
      ),
    ).toEqual([
      { paragraphId: 'p1', from: 3, to: 5 },
      { paragraphId: 'p2', from: 0, to: 5 },
      { paragraphId: 'p3', from: 0, to: 2 },
    ])
  })

  it('keeps an empty paragraph in the range as an empty segment', () => {
    const context = order({ p1: 'alpha', p2: '', p3: 'charlie' })
    expect(
      selectionSegments(
        context,
        selection(
          { paragraphId: 'p1', offset: 5 },
          { paragraphId: 'p3', offset: 0 },
        ),
      ),
    ).toEqual([
      { paragraphId: 'p1', from: 5, to: 5 },
      { paragraphId: 'p2', from: 0, to: 0 },
      { paragraphId: 'p3', from: 0, to: 0 },
    ])
    expect(
      selectionSegmentMap(
        context,
        selection(
          { paragraphId: 'p1', offset: 5 },
          { paragraphId: 'p3', offset: 0 },
        ),
      ).get('p2'),
    ).toEqual({ paragraphId: 'p2', from: 0, to: 0 })
  })

  it('treats the newline of a hard break as part of the selection', () => {
    const context = order({ p1: 'alpha\nbeta' })
    expect(
      selectionSegments(
        context,
        selection(
          { paragraphId: 'p1', offset: 3 },
          { paragraphId: 'p1', offset: 7 },
        ),
      ),
    ).toEqual([{ paragraphId: 'p1', from: 3, to: 7 }])
  })

  it('writes the paragraph break as a newline for the clipboard', () => {
    const context = order({ p1: 'alpha', p2: '', p3: 'charlie' })
    expect(
      selectionPlainText(
        context,
        selection(
          { paragraphId: 'p1', offset: 3 },
          { paragraphId: 'p3', offset: 2 },
        ),
      ),
    ).toBe('ha\n\nch')
  })
})

describe('reconciling a selection against a changed document', () => {
  const context = order({ p1: 'alpha', p2: 'bravo' })

  it('clamps an offset past the end of a paragraph that shrank', () => {
    const next = reconcileSelection(
      order({ p1: 'al', p2: 'bravo' }),
      selection(
        { paragraphId: 'p1', offset: 5 },
        { paragraphId: 'p2', offset: 2 },
      ),
    )
    expect(next?.anchor).toEqual({ paragraphId: 'p1', offset: 2 })
    expect(next?.focus).toEqual({ paragraphId: 'p2', offset: 2 })
  })

  it('drops the selection when an endpoint paragraph is gone', () => {
    expect(
      reconcileSelection(
        context,
        selection(
          { paragraphId: 'gone', offset: 0 },
          { paragraphId: 'p2', offset: 2 },
        ),
      ),
    ).toBeNull()
    expect(
      reconcileSelection(
        context,
        selection(
          { paragraphId: 'p1', offset: 0 },
          { paragraphId: 'gone', offset: 2 },
        ),
      ),
    ).toBeNull()
    expect(reconcileSelection(context, null)).toBeNull()
  })

  it('returns the same selection when nothing moved', () => {
    const current = selection(
      { paragraphId: 'p1', offset: 1 },
      { paragraphId: 'p2', offset: 2 },
    )
    expect(reconcileSelection(context, current)).toBe(current)
  })
})

describe('whole document selection', () => {
  it('runs from the first paragraph to the last', () => {
    const context = order({ p1: 'alpha', p2: 'bravo', p3: 'charlie' })
    expect(wholeDocumentSelection(context)).toEqual({
      anchor: { paragraphId: 'p1', offset: 0 },
      focus: { paragraphId: 'p3', offset: 7 },
    })
  })

  it('has nothing to select for an empty flow', () => {
    expect(wholeDocumentSelection(order({}))).toBeNull()
  })
})

describe('stepping the focus through arrow geometry', () => {
  const base = {
    paragraphId: 'p2',
    text: 'ghijkl',
    lines: lines([0, 6]),
    column: 0,
  }

  it('crosses to the previous paragraph end at offset 0', () => {
    expect(
      stepSelectionFocus({
        ...base,
        key: 'ArrowLeft',
        offset: 0,
        previous: { id: 'p1', text: 'abcdef', lines: lines([0, 6]) },
      }),
    ).toEqual({ paragraphId: 'p1', offset: 6 })
    expect(
      stepSelectionFocus({ ...base, key: 'ArrowLeft', offset: 0 }),
    ).toBeUndefined()
  })

  it('crosses to the next paragraph start at the end', () => {
    expect(
      stepSelectionFocus({
        ...base,
        key: 'ArrowRight',
        offset: 6,
        next: { id: 'p3', text: 'mnopqr', lines: lines([0, 6]) },
      }),
    ).toEqual({ paragraphId: 'p3', offset: 0 })
    expect(
      stepSelectionFocus({ ...base, key: 'ArrowRight', offset: 6 }),
    ).toBeUndefined()
  })

  it('steps one code unit inside the paragraph', () => {
    expect(stepSelectionFocus({ ...base, key: 'ArrowRight', offset: 3 })).toEqual(
      { paragraphId: 'p2', offset: 4 },
    )
  })

  it('follows the retained column across a wrapped boundary', () => {
    const wrapped = lines([0, 20], [20, 40])
    expect(
      stepSelectionFocus({
        paragraphId: 'p1',
        key: 'ArrowDown',
        offset: 35,
        text: 'x'.repeat(40),
        lines: wrapped,
        column: 12,
        next: {
          id: 'p2',
          text: 'y'.repeat(30),
          lines: lines([0, 30]),
        },
      }),
    ).toEqual({ paragraphId: 'p2', offset: 12 })
    expect(
      stepSelectionFocus({
        paragraphId: 'p1',
        key: 'ArrowDown',
        offset: 5,
        text: 'x'.repeat(40),
        lines: wrapped,
        column: 5,
      }),
    ).toEqual({ paragraphId: 'p1', offset: 25 })
  })

  it('clamps to a short neighbour line without losing the column', () => {
    expect(
      stepSelectionFocus({
        paragraphId: 'p2',
        key: 'ArrowUp',
        offset: 0,
        text: 'ghijkl',
        lines: lines([0, 6]),
        column: 40,
        previous: { id: 'p1', text: 'ab', lines: lines([0, 2]) },
      }),
    ).toEqual({ paragraphId: 'p1', offset: 2 })
  })
})
