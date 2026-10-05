import { describe, expect, it } from 'bun:test'
import {
  continuesTypingGroup,
  nextTypingGroup,
  TYPING_GROUP_WINDOW_MS,
  type HistoryEdit,
} from './document-history-grouping'

const typing = (inserted: string, paragraphId = 'p1'): HistoryEdit => ({
  kind: 'typing',
  paragraphId,
  inserted,
})

const structural: HistoryEdit = { kind: 'structural' }

function group(inserted: string, paragraphId = 'p1', at = 1_000) {
  return nextTypingGroup(typing(inserted, paragraphId), at)
}

describe('continuesTypingGroup', () => {
  it('coalesces consecutive single characters in one paragraph', () => {
    expect(continuesTypingGroup(group('a'), typing('b'), 1_100)).toBe(true)
  })

  it('coalesces a space onto the word it follows', () => {
    expect(continuesTypingGroup(group('c'), typing(' '), 1_100)).toBe(true)
  })

  it('starts a new step after a word boundary', () => {
    expect(continuesTypingGroup(group(' '), typing('d'), 1_100)).toBe(false)
  })

  it('starts a new step in another paragraph', () => {
    expect(continuesTypingGroup(group('a'), typing('b', 'p2'), 1_100)).toBe(
      false,
    )
  })

  it('starts a new step after the time window', () => {
    expect(
      continuesTypingGroup(
        group('a'),
        typing('b'),
        1_000 + TYPING_GROUP_WINDOW_MS + 1,
      ),
    ).toBe(false)
    expect(
      continuesTypingGroup(
        group('a'),
        typing('b'),
        1_000 + TYPING_GROUP_WINDOW_MS,
      ),
    ).toBe(true)
  })

  it('never coalesces a multi-character insertion or a structural edit', () => {
    expect(continuesTypingGroup(group('a'), typing('bc'), 1_100)).toBe(false)
    expect(continuesTypingGroup(group('a'), structural, 1_100)).toBe(false)
  })

  it('does not continue when no run is open', () => {
    expect(continuesTypingGroup(null, typing('b'), 1_100)).toBe(false)
  })
})

describe('nextTypingGroup', () => {
  it('opens a run for a single character and closes it otherwise', () => {
    expect(nextTypingGroup(typing('a'), 500)).toEqual({
      paragraphId: 'p1',
      last: 'a',
      at: 500,
    })
    expect(nextTypingGroup(typing('ab'), 500)).toBeNull()
    expect(nextTypingGroup(structural, 500)).toBeNull()
  })
})
