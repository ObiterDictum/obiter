import { describe, expect, it } from 'vitest'
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
})
