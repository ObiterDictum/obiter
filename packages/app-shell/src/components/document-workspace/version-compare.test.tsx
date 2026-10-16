import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach } from 'bun:test'
import type { DocumentCompareResponse } from '@obiter/contracts'
import { DocumentComparisonResult } from './version-compare'

afterEach(cleanup)

function comparison(
  overrides: Partial<DocumentCompareResponse>,
): DocumentCompareResponse {
  return {
    documentId: 'doc_1',
    base: { versionId: 'ver_1', versionNumber: 1 },
    target: { versionId: 'ver_2', versionNumber: 2 },
    identical: false,
    entries: [],
    entriesTruncated: false,
    notes: [],
    ...overrides,
  }
}

describe('DocumentComparisonResult', () => {
  it('says the versions are identical only when the API does', () => {
    render(<DocumentComparisonResult data={comparison({ identical: true })} />)
    expect(screen.getByText('These versions are identical.')).toBeTruthy()
  })

  it('paints added, removed and modified content distinctly', () => {
    render(
      <DocumentComparisonResult
        data={comparison({
          entries: [
            {
              type: 'added',
              storyPartName: 'word/document.xml',
              paragraphId: 'p2',
              text: 'New closing clause.',
              textTruncated: false,
            },
            {
              type: 'removed',
              storyPartName: 'word/document.xml',
              paragraphId: 'p1',
              text: 'Old recital.',
              textTruncated: false,
            },
            {
              type: 'modified',
              storyPartName: 'word/document.xml',
              paragraphId: 'p3',
              segments: [
                { kind: 'same', text: 'The claim ' },
                { kind: 'removed', text: 'fails.' },
                { kind: 'added', text: 'succeeds.' },
              ],
            },
          ],
        })}
      />,
    )
    expect(screen.getByText('Paragraph added')).toBeTruthy()
    expect(screen.getByText('Paragraph removed')).toBeTruthy()
    expect(screen.getByText('Paragraph modified')).toBeTruthy()
    expect(screen.getByText('New closing clause.')).toBeTruthy()
    const removed = screen.getByText('fails.')
    expect(removed.className).toContain('line-through')
    const added = screen.getByText('succeeds.')
    expect(added.className).toContain('underline')
  })

  it('names non-paragraph differences honestly', () => {
    render(
      <DocumentComparisonResult
        data={comparison({
          entries: [
            {
              type: 'formatted',
              storyPartName: 'word/document.xml',
              paragraphId: 'p7',
              text: 'Same words.',
              textTruncated: false,
            },
            { type: 'story', storyPartName: 'word/document.xml' },
            { type: 'package', area: 'styles' },
          ],
        })}
      />,
    )
    expect(screen.getByText('Formatting changed')).toBeTruthy()
    expect(screen.getByText('Structure changed')).toBeTruthy()
    expect(screen.getByText('Styles changed')).toBeTruthy()
  })

  it('surfaces truncation and notes rather than hiding them', () => {
    render(
      <DocumentComparisonResult
        data={comparison({
          entriesTruncated: true,
          notes: [
            'The comparison covers the document model; package parts outside it may also differ.',
          ],
        })}
      />,
    )
    expect(
      screen.getByText(/Only the first \d+ differences are shown/),
    ).toBeTruthy()
    expect(
      screen.getByText(/package parts outside it may also differ/),
    ).toBeTruthy()
  })
})
