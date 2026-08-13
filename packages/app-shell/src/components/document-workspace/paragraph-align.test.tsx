// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { DocumentModelPage } from './model-view'

afterEach(() => {
  cleanup()
})

function page(jc: string, text: string): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            runs: [{ id: 'r1', text, preservedXmlFragments: [] }],
            preservedXmlFragments: [`<w:pPr><w:jc w:val="${jc}"/></w:pPr>`],
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

describe('paragraph alignment while editing', () => {
  it('applies left, centre and right to the single-run editing field', () => {
    const view = (jc: string) =>
      render(
        <DocumentModelPage
          model={page(jc, 'Registered office')}
          selectedParagraphId={null}
          onSelectParagraph={() => undefined}
          editing
          onRunTextChange={() => undefined}
        />,
      )

    view('right')
    expect(screen.getByLabelText('Paragraph text').style.textAlign).toBe(
      'right',
    )
    cleanup()

    view('center')
    expect(screen.getByLabelText('Paragraph text').style.textAlign).toBe(
      'center',
    )
    cleanup()

    view('left')
    expect(screen.getByLabelText('Paragraph text').style.textAlign).toBe('left')
  })
})
