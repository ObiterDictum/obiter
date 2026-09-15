// @vitest-environment jsdom
// The rendered-range decision. Fail-first: before the repair, rangeForTarget
// clamped a range at a page-fragment boundary and every non-attachment was
// reported as the text having changed. These cases pin the truthful reason and
// prove a finding is never attached to a clamped, shorter excerpt.
import { afterEach, describe, expect, it } from 'vitest'
import {
  rangeForTarget,
  renderedRangeFor,
  renderedRangeMismatchReason,
} from './verification-anchor'
import type { FindingTarget } from './verification-mapping'

type Target = Extract<FindingTarget, { kind: 'mapped' }>

function target(overrides: Partial<Target> = {}): Target {
  return {
    kind: 'mapped',
    paragraphId: 'p1',
    storyKind: 'document',
    storyPartName: 'word/document.xml',
    start: 0,
    end: 4,
    ...overrides,
  }
}

/** One rendered paragraph fragment with a single painted line. */
function fragment({
  text,
  from,
  to,
  id = 'p1',
  story = 'document',
  part = 'word/document.xml',
}: {
  text: string
  from: number
  to: number
  id?: string
  story?: string
  part?: string
}) {
  return (
    `<div data-paragraph-id="${id}" data-paragraph-story="${story}"` +
    ` data-paragraph-part="${part}" data-paragraph-from="${from}"` +
    ` data-paragraph-to="${to}"><span data-line-from="${from}"` +
    ` data-line-to="${to}">${text}</span></div>`
  )
}

function root(html: string): HTMLElement {
  const element = document.createElement('div')
  element.innerHTML = html
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('renderedRangeFor', () => {
  it('reports a hard break as a renderer limit, not a text change', () => {
    const scope = root(fragment({ text: 'abcd', from: 0, to: 4 }))
    // The model still carries the recorded excerpt `ab\ncd`; the page never
    // paints the break, so the rendered text is "abcd".
    const decision = renderedRangeFor(scope, target(), 'ab\ncd')
    expect(decision.kind).toBe('unavailable')
    expect(decision).toMatchObject({ reason: 'range_spans_line_break' })
  })

  it('never attaches a finding to a range clamped at a page-fragment boundary', () => {
    // The reviewer's repro: [6,14) over fragments 0/10 and 10/20. The old
    // clamp returned a range reading "ghij", four of the eight characters.
    const scope = root(
      fragment({ text: 'abcdefghij', from: 0, to: 10 }) +
        fragment({ text: 'klmnopqrst', from: 10, to: 20 }),
    )
    const decision = renderedRangeFor(
      scope,
      target({ start: 6, end: 14 }),
      'ghij',
    )
    expect(decision.kind).toBe('unavailable')
    expect(decision).toMatchObject({ reason: 'range_split_across_fragments' })
    if (decision.kind === 'attached') {
      throw new Error('the clamped range was attached')
    }
  })

  it('builds the full range across page fragments before giving up', () => {
    const scope = root(
      fragment({ text: 'abcdefghij', from: 0, to: 10 }) +
        fragment({ text: 'klmnopqrst', from: 10, to: 20 }),
    )
    const decision = renderedRangeFor(
      scope,
      target({ start: 6, end: 14 }),
      'ghijklmn',
    )
    expect(decision.kind).toBe('attached')
    if (decision.kind !== 'attached') return
    expect(decision.range.toString()).toBe('ghijklmn')
    expect(decision.spansFragments).toBe(true)
  })

  it('refuses a range whose tail is not rendered rather than shortening it', () => {
    const scope = root(fragment({ text: 'abcd', from: 0, to: 4 }))
    const decision = renderedRangeFor(
      scope,
      target({ start: 0, end: 10 }),
      'abcdefghij',
    )
    expect(decision.kind).toBe('unavailable')
    expect(decision).toMatchObject({ reason: 'range_split_across_fragments' })
  })

  it('scopes a paragraph id to its story rather than the body with the same id', () => {
    const scope = root(
      fragment({ text: 'body text', from: 0, to: 9 }) +
        fragment({
          text: 'note text',
          from: 0,
          to: 9,
          story: 'footnotes',
          part: 'word/footnotes.xml',
        }),
    )
    const decision = renderedRangeFor(
      scope,
      target({
        storyKind: 'footnotes',
        storyPartName: 'word/footnotes.xml',
        start: 0,
        end: 4,
      }),
      'note',
    )
    expect(decision.kind).toBe('attached')
    if (decision.kind !== 'attached') return
    expect(decision.range.toString()).toBe('note')
  })

  it('still reports a genuine text difference as a text change', () => {
    const scope = root(fragment({ text: 'abcd', from: 0, to: 4 }))
    const decision = renderedRangeFor(scope, target(), 'abce')
    expect(decision).toMatchObject({
      kind: 'unavailable',
      reason: 'text_changed_since_check',
    })
  })

  it('reports an unrendered anchor when the page has no fragment to measure', () => {
    const scope = root('')
    const decision = renderedRangeFor(scope, target(), 'abcd')
    expect(decision).toMatchObject({
      kind: 'unavailable',
      reason: 'rendered_anchor_unavailable',
    })
  })
})

describe('rangeForTarget', () => {
  it('returns null for a target that is not mapped', () => {
    expect(
      rangeForTarget(root(''), {
        kind: 'unmapped',
        reason: 'range_not_in_document',
      }),
    ).toBeNull()
  })
})

describe('renderedRangeMismatchReason', () => {
  it('separates the renderer limits from a real text change', () => {
    expect(renderedRangeMismatchReason('a\nb', false)).toBe(
      'range_spans_line_break',
    )
    expect(renderedRangeMismatchReason('ab', true)).toBe(
      'range_split_across_fragments',
    )
    expect(renderedRangeMismatchReason('ab', false)).toBe(
      'text_changed_since_check',
    )
  })
})
