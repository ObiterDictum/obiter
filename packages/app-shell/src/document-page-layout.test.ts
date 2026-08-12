import { describe, expect, it } from 'vitest'
import {
  documentPageBox,
  marginStories,
  sectionColumns,
} from './document-page-layout'
import type { DocumentModelWire } from '@obiter/contracts'

const emptyModel: DocumentModelWire = {
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

describe('documentPageBox', () => {
  it('defaults to A4 with one-inch margins when sectPr is absent', () => {
    expect(documentPageBox(emptyModel)).toEqual({
      widthPx: 794,
      heightPx: 1123,
      margin: { top: 96, right: 96, bottom: 96, left: 96 },
      headerPx: 48,
      footerPx: 48,
    })
  })

  it('reads page size and margins from sectPr twips', () => {
    const story = emptyModel.stories[0]
    if (!story) throw new Error('expected document story')
    const model: DocumentModelWire = {
      ...emptyModel,
      stories: [
        {
          ...story,
          preservedXmlFragments: [
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="1134" w:bottom="720" w:left="1134" w:header="284" w:footer="284"/></w:sectPr>',
          ],
        },
      ],
    }
    expect(documentPageBox(model)).toEqual({
      widthPx: 794,
      heightPx: 1123,
      margin: { top: 48, right: 76, bottom: 48, left: 76 },
      headerPx: 19,
      footerPx: 19,
    })
  })
})

describe('marginStories', () => {
  it('keeps a single unnamed footer and drops extra footer parts', () => {
    const model: DocumentModelWire = {
      ...emptyModel,
      stories: [
        ...emptyModel.stories,
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f1',
              runs: [{ id: 'a', text: 'One', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          partName: 'word/footer2.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f2',
              runs: [{ id: 'b', text: 'Two', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    expect(
      marginStories(model, 'footer').map((story) => story.partName),
    ).toEqual(['word/footer1.xml'])
  })
})

describe('sectionColumns', () => {
  it('treats cols without num as a single column', () => {
    const box = documentPageBox(emptyModel)
    expect(
      sectionColumns(box, '<w:sectPr><w:cols w:space="708"/></w:sectPr>'),
    ).toEqual([{ left: 0, widthPx: 602 }])
  })

  it('splits the content frame into equal columns', () => {
    const box = documentPageBox(emptyModel)
    const columns = sectionColumns(
      box,
      '<w:sectPr><w:cols w:num="2" w:space="720"/></w:sectPr>',
    )
    expect(columns).toHaveLength(2)
    expect(columns[0]?.left).toBe(0)
    expect(columns[1]?.left).toBeGreaterThan(columns[0]?.widthPx ?? 0)
  })
})
