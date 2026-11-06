import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  documentNoteNumbers,
  documentNotes,
  paragraphNoteRefs,
} from './document-page-notes'

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
      { kind: 'footnote', noteId: '1', mark: '1', runId: 'r1', custom: false },
      { kind: 'footnote', noteId: '2', mark: '2', runId: 'r2', custom: false },
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
          fields: [],
          unanchoredFieldParagraphIds: [],
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

function notedModel(
  bodyRuns: { id: string; text: string; xml?: string }[],
  footnoteIds: string[],
  endnoteIds: string[] = [],
): DocumentModelWire {
  const story = (
    kind: 'footnotes' | 'endnotes',
    element: 'footnote' | 'endnote',
    ids: string[],
  ) => ({
    partName: `word/${kind}.xml`,
    kind,
    paragraphs: ids.map((id) =>
      noteParagraph(`${element}-${id}`, `note ${id}`),
    ),
    preservedXmlFragments: ids.map(
      (id) => `<w:${element} w:id="${id}"><w:p/></w:${element}>`,
    ),
    fields: [],
    unanchoredFieldParagraphIds: [],
  })
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'body',
            runs: bodyRuns.map((run) => ({
              id: run.id,
              text: run.text,
              preservedXmlFragments: run.xml ? [run.xml] : [],
            })),
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
      story('footnotes', 'footnote', footnoteIds),
      story('endnotes', 'endnote', endnoteIds),
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

describe('note numbering', () => {
  it('numbers footnotes in the order their references appear, not by stored id', () => {
    const model = notedModel(
      [
        { id: 'a', text: 'First', xml: '<w:footnoteReference w:id="7"/>' },
        { id: 'b', text: 'Second', xml: '<w:footnoteReference w:id="3"/>' },
        { id: 'c', text: 'Third', xml: '<w:footnoteReference w:id="12"/>' },
      ],
      ['3', '7', '12'],
    )
    expect([...documentNoteNumbers(model)]).toEqual([
      ['footnote:7', '1'],
      ['footnote:3', '2'],
      ['footnote:12', '3'],
    ])
    expect(
      documentNotes(model).map((note) => [note.noteId, note.mark]),
    ).toEqual([
      ['7', '1'],
      ['3', '2'],
      ['12', '3'],
    ])
  })

  it('counts footnotes and endnotes separately', () => {
    const model = notedModel(
      [
        { id: 'a', text: 'A', xml: '<w:endnoteReference w:id="5"/>' },
        { id: 'b', text: 'B', xml: '<w:footnoteReference w:id="5"/>' },
        { id: 'c', text: 'C', xml: '<w:endnoteReference w:id="2"/>' },
      ],
      ['5'],
      ['2', '5'],
    )
    expect([...documentNoteNumbers(model)]).toEqual([
      ['endnote:5', '1'],
      ['footnote:5', '1'],
      ['endnote:2', '2'],
    ])
  })

  it('leaves a custom-mark reference unnumbered so the next note keeps its place', () => {
    const model = notedModel(
      [
        {
          id: 'a',
          text: '',
          xml: '<w:footnoteReference w:customMarkFollows="1" w:id="1"/>',
        },
        { id: 'a-mark', text: '*' },
        { id: 'b', text: 'B', xml: '<w:footnoteReference w:id="2"/>' },
      ],
      ['1', '2'],
    )
    expect([...documentNoteNumbers(model)]).toEqual([
      ['footnote:1', ''],
      ['footnote:2', '1'],
    ])
  })
})
