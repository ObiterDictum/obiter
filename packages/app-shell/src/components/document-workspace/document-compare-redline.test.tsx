import '@obiter/test-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import type {
  DocumentCompareResponse,
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  DocumentComparisonView,
  comparisonPageZoom,
} from './document-compare-redline'

afterEach(cleanup)

const SLA_BEFORE =
  '4.2 The Supplier shall supply not less than 60,000 units each month.'
const SLA_AFTER =
  '4.2 The Supplier shall supply not less than 45,000 units each month.'

function paragraph(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r1`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

function model(paragraphs: DocumentParagraphWire[]): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs,
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}

/** The comparison the route pairs with a base and a target version. */
const comparison: DocumentCompareResponse = {
  documentId: 'doc_1',
  base: { versionId: 'ver_1', versionNumber: 1 },
  target: { versionId: 'ver_2', versionNumber: 2 },
  identical: false,
  entries: [
    {
      type: 'modified',
      storyPartName: 'word/document.xml',
      paragraphId: 'p2',
      segments: [
        { kind: 'same', text: '4.2 The Supplier shall supply not less than ' },
        { kind: 'removed', text: '60,000' },
        { kind: 'added', text: '45,000' },
        { kind: 'same', text: ' units each month.' },
      ],
    },
  ],
  entriesTruncated: false,
  notes: [],
}

describe('DocumentComparisonView', () => {
  it('strikes the words a change removed and underlines the ones it added', () => {
    render(
      <DocumentComparisonView
        data={comparison}
        base={model([paragraph('p1', 'Heading'), paragraph('p2', SLA_BEFORE)])}
        target={model([paragraph('p1', 'Heading'), paragraph('p2', SLA_AFTER)])}
        active={0}
        onActive={() => undefined}
        onClose={() => undefined}
      />,
    )
    // Both numbers are marked, in place: the diff is the reader's redline, so
    // a replaced figure must show what it replaced, not just what replaced it.
    const removed = screen.getAllByText('60,000')[0]
    const added = screen.getAllByText('45,000')[0]
    expect(removed.tagName).toBe('DEL')
    expect(removed.className).toContain('line-through')
    expect(added.tagName).toBe('INS')
    expect(added.className).toContain('underline')
    expect(
      screen.getAllByText(/The Supplier shall supply not less than/u).length,
    ).toBeGreaterThan(0)
  })
})

describe('comparisonPageZoom', () => {
  it('keeps the reading size when the desk has room for the paper', () => {
    // 1440px window, sidebar and the docked Differences panel removed.
    expect(comparisonPageZoom(808)).toBe(90)
  })

  it('shrinks the paper to the desk a docked panel leaves at 1024px', () => {
    // 1024px window: 252px sidebar and a 380px panel leave ~390px of desk.
    // At 90% the A4 sheet is 715px and runs under the panel, so the whole
    // sheet has to fit the desk instead.
    const zoom = comparisonPageZoom(392)
    expect(zoom).toBeLessThan(90)
    expect(Math.round((794 * zoom) / 100)).toBeLessThanOrEqual(392 - 64)
  })

  it('never shrinks below a size the sheet can still be read at', () => {
    expect(comparisonPageZoom(120)).toBe(40)
  })
})
