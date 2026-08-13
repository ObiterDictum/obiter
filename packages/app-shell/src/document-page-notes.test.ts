import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { documentNotes, paragraphNoteRefs } from './document-page-notes'

function noteParagraph(id: string, text: string) {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

describe('document notes', () => {
  it('maps body footnote references past separator note paragraphs', () => {
    const paragraph = {
      id: 'p1',
      runs: [
        {
          id: 'r1',
          text: 'Claim',
          preservedXmlFragments: ['<w:footnoteReference w:id="1"/>'],
        },
        {
          id: 'r2',
          text: '',
          preservedXmlFragments: ['<w:footnoteReference w:id="2"/>'],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(paragraphNoteRefs(paragraph)).toEqual([
      { kind: 'footnote', noteId: '1', mark: '1', runId: 'r1' },
      { kind: 'footnote', noteId: '2', mark: '2', runId: 'r2' },
    ])

    const separator = noteParagraph('fn-sep', '')
    const continuation = noteParagraph('fn-cont', '')
    const first = noteParagraph('fn1', 'Alice Example footnote')
    const secondBody = noteParagraph('fn2a', 'Second note')
    const secondMore = noteParagraph('fn2b', 'continued')
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
          paragraphs: [separator, continuation, first, secondBody, secondMore],
          preservedXmlFragments: [
            '<w:footnote w:id="-1"><w:p/></w:footnote>',
            '<w:footnote w:id="0"><w:p/></w:footnote>',
            '<w:footnote w:id="1"><w:p><w:r><w:t>Alice Example footnote</w:t></w:r></w:p></w:footnote>',
            '<w:footnote w:id="2"><w:p><w:r><w:t>Second note</w:t></w:r></w:p><w:p><w:r><w:t>continued</w:t></w:r></w:p></w:footnote>',
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
        paragraphs: [first],
      },
      {
        kind: 'footnote',
        noteId: '2',
        mark: '2',
        paragraphs: [secondBody, secondMore],
      },
    ])
  })
})
