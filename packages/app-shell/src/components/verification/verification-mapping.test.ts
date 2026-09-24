import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  VerificationFindingView,
} from '@obiter/contracts'
import {
  panelPlacement,
  minimumFloatingViewportPx,
} from './verification-anchor'
import {
  nextActionableIndex,
  resolveFindingTarget,
} from './verification-mapping'

const TEXT = 'See Anderson v Shetland [2012] UKSC 7 on fairness.'

function model(): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            runs: [{ id: 'r1', text: TEXT, preservedXmlFragments: [] }],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
      },
      {
        partName: 'word/footnotes.xml',
        kind: 'footnotes',
        paragraphs: [
          {
            id: 'p1',
            runs: [
              {
                id: 'f1',
                text: 'See [2014] UKSC 8.',
                preservedXmlFragments: [],
              },
            ],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

function finding(
  overrides: Partial<VerificationFindingView> = {},
): VerificationFindingView {
  const start = TEXT.indexOf('[2012] UKSC 7')
  return {
    id: 'vf_1',
    type: 'citation_resolution',
    state: 'clear',
    reviewReason: null,
    severity: null,
    confidence: null,
    requiresReview: false,
    explanation: 'The citation resolved.',
    excerpt: '[2012] UKSC 7',
    location: {
      paragraphId: 'p1',
      storyKind: 'document',
      storyPartName: 'word/document.xml',
      start,
      end: start + '[2012] UKSC 7'.length,
    },
    authorityLabel: '[2012] UKSC 7',
    evidence: [],
    ...overrides,
  }
}

describe('resolveFindingTarget', () => {
  it('maps a location whose range still carries the checked text', () => {
    const target = resolveFindingTarget(finding(), model())
    expect(target).toMatchObject({
      kind: 'mapped',
      paragraphId: 'p1',
      storyKind: 'document',
    })
  })

  it('refuses a location whose text has changed since the check', () => {
    const target = resolveFindingTarget(
      finding({ excerpt: '[2012] UKSC 9' }),
      model(),
    )
    expect(target).toEqual({
      kind: 'unmapped',
      reason: 'text_changed_since_check',
    })
  })

  it('refuses a paragraph the open document does not contain', () => {
    const target = resolveFindingTarget(
      finding({
        location: {
          paragraphId: 'p-gone',
          storyKind: 'document',
          storyPartName: 'word/document.xml',
          start: 0,
          end: 4,
        },
      }),
      model(),
    )
    expect(target).toEqual({
      kind: 'unmapped',
      reason: 'paragraph_not_in_document',
    })
  })

  it('refuses a story the open document does not contain', () => {
    const target = resolveFindingTarget(
      finding({
        location: {
          paragraphId: 'p1',
          storyKind: 'endnotes',
          storyPartName: 'word/endnotes.xml',
          start: 0,
          end: 4,
        },
      }),
      model(),
    )
    expect(target).toEqual({
      kind: 'unmapped',
      reason: 'story_not_in_document',
    })
  })

  it('refuses a range that runs past the paragraph it names', () => {
    const target = resolveFindingTarget(
      finding({
        location: {
          paragraphId: 'p1',
          storyKind: 'document',
          storyPartName: 'word/document.xml',
          start: 0,
          end: TEXT.length + 5,
        },
      }),
      model(),
    )
    expect(target).toEqual({
      kind: 'unmapped',
      reason: 'range_not_in_document',
    })
  })

  it('keeps paragraph ids scoped to their own story', () => {
    // Both stories hold a paragraph called `p1`; the footnote finding must stay
    // in the footnote story rather than landing on the body paragraph.
    const target = resolveFindingTarget(
      finding({
        excerpt: '[2014] UKSC 8',
        location: {
          paragraphId: 'p1',
          storyKind: 'footnotes',
          storyPartName: 'word/footnotes.xml',
          start: 4,
          end: 17,
        },
      }),
      model(),
    )
    expect(target).toMatchObject({ kind: 'mapped', storyKind: 'footnotes' })
  })
})

describe('nextActionableIndex', () => {
  it('prefers a flagged finding, then one needing review, then any finding', () => {
    const clear = finding({ id: 'a', state: 'clear' })
    const review = finding({ id: 'b', state: 'review_required' })
    const flagged = finding({ id: 'c', state: 'flagged' })
    expect(nextActionableIndex([clear, review])).toBe(1)
    expect(nextActionableIndex([clear, review, flagged])).toBe(2)
    expect(nextActionableIndex([clear])).toBe(0)
    expect(nextActionableIndex([])).toBe(-1)
  })
})

describe('panelPlacement', () => {
  it('keeps the floating panel only where the viewport can hold it', () => {
    expect(panelPlacement(minimumFloatingViewportPx)).toBe('floating')
    expect(panelPlacement(minimumFloatingViewportPx - 1)).toBe('drawer')
  })
})
