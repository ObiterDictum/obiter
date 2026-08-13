import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { documentNotes, paragraphNoteRefs } from './document-page-notes'

describe('document notes', () => {
  it('maps body footnote references to footnote story paragraphs', () => {
    const paragraph = {
      id: 'p1',
      runs: [
        {
          id: 'r1',
          text: 'Claim',
          preservedXmlFragments: ['<w:footnoteReference w:id="1"/>'],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(paragraphNoteRefs(paragraph)).toEqual([
      { kind: 'footnote', noteId: '1', mark: '1', runId: 'r1' },
    ])

    const model: DocumentModelWire = {
      version: 1,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [paragraph],
          preservedXmlFragments: [],
        },
        {
          partName: 'word/footnotes.xml',
          kind: 'footnotes',
          paragraphs: [
            {
              id: 'fn1',
              runs: [
                {
                  id: 'fnr1',
                  text: 'Alice Example footnote',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [
            '<w:footnote w:id="-1"><w:p/></w:footnote>',
            '<w:footnote w:id="1"><w:p><w:r><w:t>Alice Example footnote</w:t></w:r></w:p></w:footnote>',
          ],
        },
      ],
      styles: [],
      numbering: [],
      relationships: [],
      preservedXmlFragments: [],
      changes: [],
    }

    expect(documentNotes(model)).toEqual([
      {
        kind: 'footnote',
        noteId: '1',
        mark: '1',
        paragraphs: model.stories[1]?.paragraphs,
      },
    ])
  })
})
