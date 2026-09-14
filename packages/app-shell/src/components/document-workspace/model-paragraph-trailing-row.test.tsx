// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { paragraphFace, paragraphLineHeightPx } from '../../document-page-style'
import { DocumentModelPage } from './model-view'

afterEach(() => {
  cleanup()
})

const WRAP_WIDTH_PX = 80

function para(id: string, text: string): DocumentParagraphWire {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

function doc(paragraph: DocumentParagraphWire): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [paragraph],
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

function linePxOf(paragraph: DocumentParagraphWire): number {
  return paragraphLineHeightPx(paragraphFace(paragraph, []))
}

function renderParagraph(
  paragraph: DocumentParagraphWire,
  options: { selected?: boolean; offset?: number } = {},
) {
  const selected = options.selected === true
  const container = render(
    <DocumentModelPage
      model={doc(paragraph)}
      pageBlocks={[
        { type: 'paragraph', paragraph, wrapWidthPx: WRAP_WIDTH_PX },
      ]}
      selectedParagraphId={selected ? paragraph.id : null}
      restoreCaret={
        selected
          ? { paragraphId: paragraph.id, offset: options.offset ?? 0 }
          : null
      }
      onSelectParagraph={() => undefined}
      editing
      onRunTextChange={() => undefined}
    />,
  ).container
  return {
    container,
    field: container.querySelector('textarea'),
    rows: container.querySelectorAll('.whitespace-pre'),
  }
}

describe('the painted rows of a paragraph ending in a hard break', () => {
  it('draws the empty row the trailing break opens', () => {
    const { rows } = renderParagraph(para('p1', 'alpha\n'))
    expect(rows).toHaveLength(2)
    // The empty row paints a blank placeholder rather than any text.
    expect((rows[1]?.textContent ?? '').trim()).toBe('')
  })

  it('gives the editor height for the empty row so the caret is not clipped', () => {
    const paragraph = para('p1', 'alpha\n')
    const { field } = renderParagraph(paragraph, { selected: true })
    expect(field?.style.height).toBe(`${2 * linePxOf(paragraph)}px`)
  })

  it('restores the caret at the final offset on the empty row', () => {
    const { field } = renderParagraph(para('p1', 'alpha\n'), {
      selected: true,
      offset: 6,
    })
    expect(field?.value).toBe('alpha\n')
    expect(field?.selectionStart).toBe(6)
  })

  it('draws one row for each of two trailing breaks', () => {
    const { rows } = renderParagraph(para('p1', 'alpha\n\n'))
    expect(rows).toHaveLength(3)
  })

  it('draws no extra row without a trailing break', () => {
    const paragraph = para('p1', 'alpha')
    const { rows, field } = renderParagraph(paragraph, { selected: true })
    expect(rows).toHaveLength(1)
    expect(field?.style.height).toBe(`${linePxOf(paragraph)}px`)
  })
})
