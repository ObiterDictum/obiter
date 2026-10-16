import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import { documentListMarkers } from './document-page-lists'

function listModel(): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            runs: [{ id: 'r1', text: 'First', preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
            ],
          },
          {
            id: 'p2',
            runs: [{ id: 'r2', text: 'Nested', preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr>',
            ],
          },
          {
            id: 'p3',
            runs: [{ id: 'r3', text: 'Second', preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
            ],
          },
          {
            id: 'p4',
            runs: [{ id: 'r4', text: 'Bullet', preservedXmlFragments: [] }],
            preservedXmlFragments: [
              '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>',
            ],
          },
        ],
        preservedXmlFragments: [],
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [
      {
        numberingId: '1',
        sourceFragment: '<w:num w:numId="1"/>',
        levels: [
          {
            ilvl: 0,
            start: 1,
            numFmt: 'decimal',
            lvlText: '%1.',
            indentLeftTwips: 720,
            hangingTwips: 360,
          },
          {
            ilvl: 1,
            start: 1,
            numFmt: 'lowerLetter',
            lvlText: '(%2)',
            indentLeftTwips: 1440,
            hangingTwips: 360,
          },
        ],
      },
      {
        numberingId: '2',
        sourceFragment: '<w:num w:numId="2"/>',
        levels: [{ ilvl: 0, start: 1, numFmt: 'bullet' }],
      },
    ],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
  }
}

describe('documentListMarkers', () => {
  it('numbers nested legal lists and bullets from numbering levels', () => {
    const markers = documentListMarkers(listModel())
    expect(markers.get('p1')).toMatchObject({ text: '1.' })
    expect(markers.get('p2')).toMatchObject({ text: '(a)' })
    expect(markers.get('p3')).toMatchObject({ text: '2.' })
    expect(markers.get('p4')).toMatchObject({ text: '•' })
    expect(markers.get('p1')?.hangingPx).toBeGreaterThan(0)
    expect(markers.get('p2')?.leftPx).toBeGreaterThan(
      markers.get('p1')?.leftPx ?? 0,
    )
  })

  it('reads numbering from a paragraph style when numPr is not on the paragraph', () => {
    const model = listModel()
    const first = model.stories[0]?.paragraphs[0]
    if (!first) throw new Error('expected paragraph')
    first.styleId = 'ListNumber'
    first.preservedXmlFragments = []
    model.styles = [
      {
        styleId: 'ListNumber',
        sourceFragment:
          '<w:style w:styleId="ListNumber"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:style>',
      },
    ]
    expect(documentListMarkers(model).get('p1')?.text).toBe('1.')
  })

  it('does not number from a numPr that exists only inside a tracked pPrChange', () => {
    const model = listModel()
    const first = model.stories[0]?.paragraphs[0]
    if (!first) throw new Error('expected paragraph')
    first.styleId = 'TrackedList'
    first.preservedXmlFragments = [
      '<w:pPr><w:pPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:pPrChange></w:pPr>',
    ]
    model.styles = [
      {
        styleId: 'TrackedList',
        sourceFragment:
          '<w:style w:styleId="TrackedList"><w:pPr><w:pPrChange w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:pPrChange></w:pPr></w:style>',
      },
    ]
    expect(documentListMarkers(model).get('p1')).toBeUndefined()
  })

  it('does not apply an override declared at another level to ilvl 0', () => {
    const model = listModel()
    const instance = model.numbering[0]
    if (!instance) throw new Error('expected numbering instance')
    model.numbering[0] = {
      ...instance,
      startOverride: 5,
      sourceFragment:
        '<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="2"><w:startOverride w:val="5"/></w:lvlOverride></w:num>',
      levels: [
        { ilvl: 0, start: 1, numFmt: 'decimal', lvlText: '%1.' },
        { ilvl: 1, start: 1, numFmt: 'lowerLetter', lvlText: '(%2)' },
        { ilvl: 2, start: 5, numFmt: 'decimal', lvlText: '%3.' },
      ],
    }
    // The instance's first override is at ilvl 2; p1 and p3 sit at ilvl 0 and
    // must keep counting from the abstract start.
    const markers = documentListMarkers(model)
    expect(markers.get('p1')?.text).toBe('1.')
    expect(markers.get('p3')?.text).toBe('2.')
  })
})
