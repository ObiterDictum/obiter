import { describe, expect, it } from 'bun:test'
import {
  DOCUMENT_EDIT_COLOUR_PATTERN,
  type DocumentModelWire,
} from '@obiter/contracts'
import {
  collectEditOperations,
  runPropertiesFromFragments,
} from './document-edits'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [{ id: 'r1', text: 'Hello', preservedXmlFragments: [] }],
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

function readColour(value: string): string | null {
  return runPropertiesFromFragments([
    `<w:rPr><w:color w:val="${value}"/></w:rPr>`,
  ]).colour
}

describe('run colour canonicalisation', () => {
  it('reads auto, however cased, as the contract lower-case auto', () => {
    expect(readColour('AUTO')).toBe('auto')
    expect(readColour('auto')).toBe('auto')
  })

  it('upcases six-hex so the read matches control state', () => {
    expect(readColour('ff0000')).toBe('FF0000')
    expect(readColour('0a0B0c')).toBe('0A0B0C')
  })

  it('drops a value the edit contract will not carry', () => {
    expect(readColour('red')).toBeNull()
    expect(readColour('F00')).toBeNull()
  })

  it('carries the canonical colour on the save operation', () => {
    const operations = collectEditOperations(
      model,
      {},
      [
        {
          clientId: 'local_colour',
          afterParagraphId: 'p1',
          text: 'x',
          runs: [
            {
              id: 'local_colour-r0',
              text: 'x',
              preservedXmlFragments: [
                '<w:rPr><w:color w:val="ff0000"/></w:rPr>',
              ],
            },
          ],
        },
      ],
      [],
    )
    expect(operations).toEqual([
      {
        type: 'insert_paragraph_after',
        paragraphId: 'p1',
        intentId: 'local_colour',
        runs: [{ text: 'x', colour: 'FF0000' }],
      },
    ])
    // The canonical form the read produces is exactly what the write contract
    // accepts, so a lower-case source never reaches the server raw.
    expect(DOCUMENT_EDIT_COLOUR_PATTERN.test('FF0000')).toBe(true)
  })
})
