import { describe, expect, it } from 'bun:test'
import type { DocumentChangeWire } from '@obiter/contracts'
import {
  itemChangeIds,
  itemDecidable,
  itemKindLabel,
  itemLead,
  itemUnpairable,
  reviewCounts,
  reviewCountsLabel,
  reviewItems,
} from './review-items'

function insertion(id: string, overrides: Partial<DocumentChangeWire> = {}) {
  return {
    id,
    inlinePosition: null,
    elementName: 'ins',
    kind: 'insert',
    storyPartName: 'word/document.xml',
    text: `text of ${id}`,
    ...overrides,
  } as DocumentChangeWire
}

function moveFrom(id: string, pairId?: string) {
  return {
    id,
    inlinePosition: null,
    elementName: 'moveFrom',
    kind: 'move',
    direction: 'from',
    storyPartName: 'word/document.xml',
    text: 'moved words',
    ...(pairId === undefined
      ? { undecidable: 'unsupported-move' as const }
      : { pairId }),
  } as DocumentChangeWire
}

function moveTo(id: string, pairId?: string) {
  return {
    id,
    inlinePosition: null,
    elementName: 'moveTo',
    kind: 'move',
    direction: 'to',
    storyPartName: 'word/document.xml',
    text: 'moved words',
    ...(pairId === undefined
      ? { undecidable: 'unsupported-move' as const }
      : { pairId }),
  } as DocumentChangeWire
}

describe('reviewItems', () => {
  it('shows a paired move as one row, decided by both its halves', () => {
    const items = reviewItems([
      moveFrom('chg_from', 'chg_to'),
      moveTo('chg_to', 'chg_from'),
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('move')
    expect(itemChangeIds(items[0]!)).toEqual(['chg_from', 'chg_to'])
    expect(itemDecidable(items[0]!)).toBe(true)
    expect(itemKindLabel(items[0]!)).toBe('Move')
  })

  it('pairs every wrapper of one move, not only the first pair', () => {
    // Word groups a move by its named range containers: each wrapper points at
    // one half of the other side, so a two-wrapper move is four wire changes.
    const items = reviewItems([
      moveFrom('from_a', 'to_a'),
      moveTo('to_a', 'from_a'),
      moveFrom('from_b', 'to_a'),
      moveTo('to_b', 'from_a'),
    ])
    expect(items).toHaveLength(1)
    expect(new Set(itemChangeIds(items[0]!))).toEqual(
      new Set(['from_a', 'to_a', 'from_b', 'to_b']),
    )
  })

  it('keeps an unpairable move half a move, never an insert or a delete', () => {
    // The parser only resolves `pairId` for a pair it can decide, so a half it
    // could not pair carries no link. The row is still a move, and it says it
    // cannot be paired rather than claiming a direction the panel cannot
    // place against the other half.
    const items = reviewItems([insertion('chg_ins'), moveFrom('chg_stray')])
    expect(items.map((item) => item.kind)).toEqual(['change', 'move'])
    expect(itemKindLabel(items[1]!)).toBe("Move · can't be paired")
    expect(itemUnpairable(items[1]!)).toBe(true)
    expect(itemDecidable(items[1]!)).toBe(false)
    expect(itemLead(items[1]!).id).toBe('chg_stray')
    expect(reviewItems([moveTo('chg_stray')])[0]?.kind).toBe('move')
    expect(itemKindLabel(reviewItems([moveTo('chg_stray')])[0]!)).toBe(
      "Move · can't be paired",
    )
  })

  it('keeps document order and one row per change', () => {
    const items = reviewItems([
      insertion('chg_1'),
      insertion('chg_2', { kind: 'delete', elementName: 'del' }),
      insertion('chg_3'),
    ])
    expect(items.map((item) => itemLead(item).id)).toEqual([
      'chg_1',
      'chg_2',
      'chg_3',
    ])
    expect(itemKindLabel(items[1]!)).toBe('Deletion')
  })
})

describe('reviewCounts', () => {
  it('counts changes, comments and moves apart', () => {
    const items = reviewItems([
      insertion('chg_1'),
      insertion('chg_2'),
      insertion('chg_3'),
      moveFrom('chg_move'),
    ])
    const counts = reviewCounts(items)
    expect(counts).toMatchObject({ changes: 3, moves: 1, manualMoves: 1 })
    expect(reviewCountsLabel(counts, 2)).toBe(
      '3 changes · 2 comments · 1 move requiring manual review',
    )
  })

  it('names a move as a move when it can be decided', () => {
    const items = reviewItems([moveFrom('a', 'b'), moveTo('b', 'a')])
    const counts = reviewCounts(items)
    expect(counts).toMatchObject({ changes: 0, moves: 1, manualMoves: 0 })
    expect(reviewCountsLabel(counts, 0)).toBe('0 changes · 1 move')
  })

  it('names the undecidable move even when another move can be decided', () => {
    const items = reviewItems([
      moveFrom('pair_a', 'pair_b'),
      moveTo('pair_b', 'pair_a'),
      moveFrom('chg_stray'),
    ])
    expect(reviewCounts(items)).toMatchObject({ moves: 2, manualMoves: 1 })
    expect(reviewCountsLabel(reviewCounts(items), 0)).toBe(
      '0 changes · 2 moves (1 requiring manual review)',
    )
  })

  it('counts a formatting change no decision can run on as undecidable', () => {
    const items = reviewItems([
      insertion('chg_prop', {
        kind: 'property',
        elementName: 'pPrChange',
        scope: 'paragraph',
        text: '',
        undecidable: 'missing-property-snapshot',
      }),
    ])
    expect(reviewCounts(items)).toMatchObject({ changes: 1, undecidable: 1 })
    expect(itemKindLabel(items[0]!)).toBe('Formatting')
  })
})
