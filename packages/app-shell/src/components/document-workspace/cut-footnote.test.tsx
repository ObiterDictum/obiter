import '@obiter/test-dom'
import { fireEvent } from '@testing-library/react'
import { expect, it } from 'bun:test'
import {
  mountWorkspace,
  multiParagraphModel,
  paragraph,
  command,
} from './docx-workspace-harness'
import {
  bodyField,
  clickParagraph,
  nativeSelect,
  selectionStatus,
} from './paragraph-selection-harness'

it('warns after a cut removes two stored notes and Undo restores both references', () => {
  const body = paragraph('p1', 'Alpha Bravo')
  body.runs = [
    { id: 'r1', text: 'Alpha', preservedXmlFragments: [] },
    {
      id: 'ref1',
      text: '',
      preservedXmlFragments: ['<w:footnoteReference w:id="1"/>'],
    },
    { id: 'r2', text: ' Bravo', preservedXmlFragments: [] },
    {
      id: 'ref2',
      text: '',
      preservedXmlFragments: ['<w:footnoteReference w:id="2"/>'],
    },
  ]
  const model = multiParagraphModel([body])
  model.stories.push({
    partName: 'word/footnotes.xml',
    kind: 'footnotes',
    paragraphs: [paragraph('n1', 'Citation A'), paragraph('n2', 'Citation B')],
    preservedXmlFragments: [
      '<w:footnote w:id="1"><w:p/></w:footnote>',
      '<w:footnote w:id="2"><w:p/></w:footnote>',
    ],
    fields: [],
    unanchoredFieldParagraphIds: [],
  })
  mountWorkspace({ models: { doc_1: model } })
  clickParagraph('p1')
  nativeSelect(0, 11)
  const copied: Record<string, string> = {}
  fireEvent.cut(bodyField(), {
    clipboardData: {
      setData: (type: string, text: string) => {
        copied[type] = text
      },
    },
  })
  expect(copied['text/plain']).toBe('Alpha Bravo')
  expect(selectionStatus()).toContain('2 footnotes were removed')
  fireEvent.click(command('Undo'))
  expect(document.querySelectorAll('[data-note-mark]')).toHaveLength(2)
  fireEvent.click(command('Redo'))
  expect(document.querySelectorAll('[data-note-mark]')).toHaveLength(0)
})
