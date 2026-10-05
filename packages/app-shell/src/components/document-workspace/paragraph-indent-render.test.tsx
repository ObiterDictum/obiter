import '@obiter/test-dom'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'
import { DocumentModelPage } from './model-view'

afterEach(() => {
  cleanup()
})

/*
 * A wrapped paragraph paints one block per visual line inside a wrapper whose
 * inherited `text-indent` applies to the first line of every block. Only the
 * first block may keep that indent; every later block must reset it, or each
 * wrapped line shifts and the paragraph paints as if it had no indent.
 */

function indentedModel(indentAttr: string) {
  const paragraph: DocumentParagraphWire = {
    id: 'p1',
    runs: [
      {
        id: 'r1',
        text: 'lorem ipsum dolor sit amet '.repeat(4).trim(),
        preservedXmlFragments: [],
      },
    ],
    preservedXmlFragments: [`<w:pPr><w:ind ${indentAttr}/></w:pPr>`],
  }
  const model: DocumentModelWire = {
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
  const { container } = render(
    <DocumentModelPage
      model={model}
      pageBlocks={[{ type: 'paragraph', paragraph, wrapWidthPx: 420 }]}
      selectedParagraphId={null}
      onSelectParagraph={() => undefined}
      editing
    />,
  )
  return [...container.querySelectorAll<HTMLElement>('[data-line-from]')]
}

describe('wrapped paragraph indent painting', () => {
  for (const [label, attr] of [
    ['first-line', 'w:firstLine="720"'],
    ['hanging', 'w:hanging="720"'],
  ] as const) {
    it(`keeps the ${label} indent on the first line and resets the rest`, () => {
      const rows = indentedModel(attr)
      expect(rows.length).toBeGreaterThan(1)
      const [first, ...rest] = rows
      if (!first) throw new Error('expected wrapped rows')
      // The first block inherits the wrapper's indent.
      expect(first.style.textIndent).toBe('')
      // Later blocks reset it so only the first line is indented.
      for (const row of rest) expect(row.style.textIndent).toBe('0px')
    })
  }
})
