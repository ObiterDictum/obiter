import { describe, expect, it } from 'vitest'
import {
  drawingBoxSize,
  drawingShapeFill,
  imagePartNameForDrawing,
  marginStoryVisible,
  paragraphAlignClass,
  paragraphHasImage,
  readableRunColor,
  runDisplayText,
  runEmphasisClass,
  tabColumns,
  xmlContainsImage,
} from './document-page-media'

const drawing =
  '<w:drawing><wp:inline><wp:extent cx="1714500" cy="457200"/><a:blip r:embed="rId1"/></wp:inline></w:drawing>'

describe('xmlContainsImage', () => {
  it('detects DrawingML pictures and ignores bookmarks', () => {
    expect(xmlContainsImage(drawing)).toBe(true)
    expect(xmlContainsImage('<w:bookmarkStart w:id="1"/>')).toBe(false)
  })
})

describe('paragraphHasImage', () => {
  it('reads drawings preserved on the run', () => {
    expect(
      paragraphHasImage({
        id: 'p1',
        runs: [{ id: 'r1', text: '', preservedXmlFragments: [drawing] }],
        preservedXmlFragments: [],
      }),
    ).toBe(true)
  })
})

describe('marginStoryVisible', () => {
  it('keeps image-only headers visible', () => {
    expect(
      marginStoryVisible({
        partName: 'word/header1.xml',
        kind: 'header',
        paragraphs: [
          {
            id: 'h1',
            runs: [{ id: 'hr1', text: '', preservedXmlFragments: [drawing] }],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
      }),
    ).toBe(true)
  })
})

describe('paragraphAlignClass', () => {
  it('maps Word justification onto page alignment', () => {
    expect(
      paragraphAlignClass({
        id: 'p1',
        runs: [],
        preservedXmlFragments: ['<w:pPr><w:jc w:val="center"/></w:pPr>'],
      }),
    ).toBe('text-center')
  })
})

describe('runEmphasisClass', () => {
  it('turns on bold and italic from run properties', () => {
    expect(
      runEmphasisClass({
        id: 'r1',
        text: 'Acme',
        preservedXmlFragments: ['<w:rPr><w:b/><w:i/></w:rPr>'],
      }),
    ).toBe('font-semibold italic')
  })
})

describe('imagePartNameForDrawing', () => {
  it('resolves a header blip to the media part', () => {
    expect(
      imagePartNameForDrawing(drawing, 'word/header1.xml', [
        {
          sourcePartName: 'word/header1.xml',
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
          target: 'media/image1.png',
          sourceFragment: '',
        },
      ]),
    ).toBe('word/media/image1.png')
  })
})

describe('drawingBoxSize', () => {
  it('converts EMU extents into CSS pixels', () => {
    expect(drawingBoxSize(drawing)).toEqual({ width: 180, height: 48 })
  })
})

describe('readableRunColor', () => {
  it('drops white text unless it sits on a dark fill', () => {
    expect(readableRunColor('#FFFFFF')).toBeUndefined()
    expect(readableRunColor('#FFFFFF', '#3A3A3A')).toBe('#FFFFFF')
  })
})

describe('drawingShapeFill', () => {
  it('reads a DrawingML solid fill', () => {
    expect(
      drawingShapeFill(
        '<w:drawing><wps:spPr><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></wps:spPr></w:drawing>',
      ),
    ).toBe('#A6A6A6')
  })

  it('maps theme bg2 onto light grey', () => {
    expect(
      drawingShapeFill(
        '<w:drawing><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></w:drawing>',
      ),
    ).toBe('#E7E6E6')
  })

  it('prefers a resolved VML fill over a theme colour', () => {
    expect(
      drawingShapeFill(
        '<w:drawing><a:schemeClr val="tx2"/><v:rect fillcolor="#212934 [1615]"/></w:drawing>',
      ),
    ).toBe('#212934')
  })
})

describe('tabColumns', () => {
  it('splits runs on Word tab marks', () => {
    const columns = tabColumns({
      id: 'p1',
      runs: [
        { id: 'a', text: 'phone', preservedXmlFragments: [] },
        { id: 't', text: '', preservedXmlFragments: ['<w:tab/>'] },
        { id: 'b', text: '1', preservedXmlFragments: [] },
        { id: 'u', text: '', preservedXmlFragments: ['<w:tab/>'] },
        { id: 'c', text: 'www', preservedXmlFragments: [] },
      ],
      preservedXmlFragments: [],
    })
    expect(columns?.map((column) => column.map((run) => run.text))).toEqual([
      ['phone'],
      ['1'],
      ['www'],
    ])
  })

  it('splits a run that carries both text and a tab mark', () => {
    const columns = tabColumns({
      id: 'p1',
      runs: [
        { id: 'a', text: 'phone', preservedXmlFragments: ['<w:tab/>'] },
        { id: 'b', text: '1', preservedXmlFragments: ['<w:tab/>'] },
        { id: 'c', text: 'www', preservedXmlFragments: [] },
      ],
      preservedXmlFragments: [],
    })
    expect(columns?.map((column) => column.map((run) => run.text))).toEqual([
      ['phone'],
      ['1'],
      ['www'],
    ])
  })
})

describe('runDisplayText', () => {
  it('shows 1 for an empty PAGE field', () => {
    expect(
      runDisplayText({
        id: 'r1',
        text: '',
        preservedXmlFragments: ['<w:instrText xml:space="preserve"> PAGE </w:instrText>'],
      }),
    ).toBe('1')
  })
})
