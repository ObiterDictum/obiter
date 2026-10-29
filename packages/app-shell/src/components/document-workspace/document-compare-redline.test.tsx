import '@obiter/test-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import type {
  DocumentCompareResponse,
  DocumentParagraphWire,
} from '@obiter/contracts'
import {
  DocumentComparisonView,
  comparisonPageLayout,
} from './document-compare-redline'
import { wireModel as model } from '../../document-wire-test-support'

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

describe('comparisonPageLayout', () => {
  it('keeps the reading size when the desk has room for the paper', () => {
    expect(comparisonPageLayout(808)).toEqual({ zoom: 90, width: 794 })
  })

  it('narrows the sheet at a readable size beside a docked panel at 1024px', () => {
    const { zoom, width } = comparisonPageLayout(392)
    expect(zoom).toBe(80)
    expect(Math.round((width * zoom) / 100)).toBeLessThanOrEqual(392 - 64)
  })
})
