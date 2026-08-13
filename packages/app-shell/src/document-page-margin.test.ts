import { describe, expect, it } from 'vitest'
import {
  footerBandFill,
  footerLetterhead,
  headerLetterhead,
  marginBandHeights,
  paragraphTabStops,
} from './document-page-margin'
import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'

const logo =
  '<w:drawing><wp:inline><wp:extent cx="1714500" cy="457200"/><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
const bar =
  '<w:drawing><wp:extent cx="3000000" cy="457200"/><a:solidFill><a:srgbClr val="A6A6A6"/></a:solidFill></w:drawing>'

describe('headerLetterhead', () => {
  it('builds a three-part bar from a logo and flanking shapes', () => {
    const story: DocumentStoryWire = {
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [
        {
          id: 'h1',
          runs: [
            { id: 's1', text: '', preservedXmlFragments: [bar] },
            { id: 'p1', text: '', preservedXmlFragments: [logo] },
            { id: 's2', text: '', preservedXmlFragments: [bar] },
          ],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(headerLetterhead(story, [])).toEqual({
      pictures: [logo],
      leftFill: '#A6A6A6',
      rightFill: '#A6A6A6',
      heightPx: 48,
    })
  })

  it('leaves a DrawingML letterhead group to the drawing renderer', () => {
    const group =
      '<w:drawing><wpg:wgp><wps:wsp><a:xfrm><a:off x="0" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:solidFill><a:srgbClr val="212934"/></a:solidFill></wps:wsp><wps:wsp><a:xfrm><a:off x="2000" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm><a:solidFill><a:srgbClr val="212934"/></a:solidFill></wps:wsp><pic:pic><a:blip r:embed="rId1"/><a:xfrm><a:off x="1000" y="0"/><a:ext cx="1000" cy="1000"/></a:xfrm></pic:pic></wpg:wgp></w:drawing>'
    const story: DocumentStoryWire = {
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [
        {
          id: 'h1',
          runs: [{ id: 'r1', text: '', preservedXmlFragments: [group] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(headerLetterhead(story, [])).toBeUndefined()
  })

  it('leaves a shaded three-cell table to the table renderer', () => {
    const tables = [
      {
        bordered: false,
        paragraphIds: [],
        rows: [
          {
            cells: [
              { fill: '#A6A6A6', span: 1, paragraphIds: [] },
              { span: 1, paragraphIds: [] },
              { fill: '#A6A6A6', span: 1, paragraphIds: [] },
            ],
          },
        ],
      },
    ]
    const story: DocumentStoryWire = {
      partName: 'word/header1.xml',
      kind: 'header',
      paragraphs: [
        {
          id: 'h1',
          runs: [{ id: 'p1', text: '', preservedXmlFragments: [logo] }],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(headerLetterhead(story, tables)).toBeUndefined()
  })
})

describe('footerLetterhead', () => {
  it('keeps one copy of text-box columns and ignores the fallback mash', () => {
    const choice =
      '<mc:Choice><w:txbxContent><w:p><w:r><w:t>+44111</w:t></w:r><w:r><w:t xml:space="preserve">          </w:t></w:r><w:r><w:t>www.example.com</w:t></w:r></w:p><w:p><w:r><w:t>1 Example Street</w:t></w:r><w:r><w:t xml:space="preserve">          </w:t></w:r><w:r><w:t>Company Registration Number: 1</w:t></w:r></w:p></w:txbxContent></mc:Choice>'
    const fallback =
      '<mc:Fallback><w:txbxContent><w:p><w:r><w:t>+44111</w:t></w:r><w:r><w:t xml:space="preserve">          </w:t></w:r><w:r><w:t>www.example.com</w:t></w:r></w:p></w:txbxContent></mc:Fallback>'
    const shape =
      '<w:drawing><a:solidFill><a:srgbClr val="212934"/></a:solidFill></w:drawing>'
    const drawing = `<w:drawing>${choice}${fallback}</w:drawing>`
    const story: DocumentStoryWire = {
      partName: 'word/footer1.xml',
      kind: 'footer',
      paragraphs: [
        {
          id: 'outer',
          runs: [
            { id: 'd', text: '', preservedXmlFragments: [drawing, shape] },
            { id: 'n', text: '1', preservedXmlFragments: [] },
          ],
          preservedXmlFragments: [
            '<w:sdt><w:docPartGallery w:val="Page Numbers (Bottom of Page)"/></w:sdt>',
          ],
        },
        {
          id: 'dup1',
          runs: [
            {
              id: 'a',
              text: '+44111          www.example.com',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          id: 'dup2',
          runs: [
            {
              id: 'b',
              text: '+44111          www.example.com',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(footerLetterhead(story)?.rows).toEqual([
      { left: '+44111', right: 'www.example.com' },
      { left: '1 Example Street', right: 'Company Registration Number: 1' },
    ])
    expect(footerLetterhead(story)?.page).toBe('1')
    expect(footerLetterhead(story, 2)?.page).toBe('2')
  })

  it('reads text-box columns from a later Choice when the first has none', () => {
    const drawing =
      '<w:drawing><mc:Choice Requires="wpg"><wps:wsp/></mc:Choice><mc:Choice Requires="wps"><w:txbxContent><w:p><w:r><w:t>+44111</w:t></w:r><w:r><w:t xml:space="preserve">          </w:t></w:r><w:r><w:t>www.example.com</w:t></w:r></w:p></w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent><w:p><w:r><w:t>+44111</w:t></w:r><w:r><w:t xml:space="preserve">          </w:t></w:r><w:r><w:t>www.example.com</w:t></w:r></w:p></w:txbxContent></mc:Fallback></w:drawing>'
    const story: DocumentStoryWire = {
      partName: 'word/footer1.xml',
      kind: 'footer',
      paragraphs: [
        {
          id: 'outer',
          runs: [
            {
              id: 'd',
              text: '',
              preservedXmlFragments: [
                drawing,
                '<w:drawing><a:solidFill><a:srgbClr val="212934"/></a:solidFill></w:drawing>',
              ],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          id: 'dup',
          runs: [
            {
              id: 'a',
              text: '+44111          www.example.com',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          id: 'dup2',
          runs: [
            {
              id: 'b',
              text: '+44111          www.example.com',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(footerLetterhead(story)?.rows).toEqual([
      { left: '+44111', right: 'www.example.com' },
    ])
  })

  it('dedupes matching story lines when the drawing has no text box', () => {
    const story: DocumentStoryWire = {
      partName: 'word/footer1.xml',
      kind: 'footer',
      paragraphs: [
        {
          id: 'a',
          runs: [
            {
              id: '1',
              text: '+44111          www.example.com',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          id: 'b',
          runs: [
            {
              id: '2',
              text: '+44111          www.example.com',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          id: 'c',
          runs: [
            {
              id: '3',
              text: '1 Street          Company Registration Number: 1',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        {
          id: 'd',
          runs: [
            {
              id: '4',
              text: '1 Street          Company Registration Number: 1',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
    expect(footerLetterhead(story)?.rows).toEqual([
      { left: '+44111', right: 'www.example.com' },
      { left: '1 Street', right: 'Company Registration Number: 1' },
    ])
  })
})

describe('marginBandHeights', () => {
  it('uses the footer letterhead height when it is present', () => {
    const shape =
      '<w:drawing><wp:extent cx="7560310" cy="1371600"/><a:solidFill><a:srgbClr val="3A3A3A"/></a:solidFill></w:drawing>'
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
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f1',
              runs: [{ id: 's1', text: '', preservedXmlFragments: [shape] }],
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
    expect(marginBandHeights(model).footerPx).toBeGreaterThanOrEqual(72)
  })

  it('counts a grouped header drawing without the Word header distance', () => {
    const group =
      '<w:drawing><wpg:wgp><a:xfrm><a:off x="0" y="0"/><a:ext cx="9129802" cy="1314450"/></a:xfrm><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="276045"/><a:ext cx="1238250" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><wps:wsp><wps:spPr><a:xfrm><a:off x="3062377" y="276045"/><a:ext cx="6067425" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><pic:pic><a:blip r:embed="rId1"/><a:xfrm><a:off x="1371600" y="0"/><a:ext cx="1454785" cy="1314450"/></a:xfrm></pic:pic></wpg:wgp></w:drawing>'
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
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [{ id: 'r1', text: '', preservedXmlFragments: [group] }],
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
    expect(marginBandHeights(model).headerPx).toBe(186)
  })

  it('counts a negative header anchor from the page edge', () => {
    const group =
      '<w:drawing><wp:anchor><wp:positionV relativeFrom="page"><wp:posOffset>-280035</wp:posOffset></wp:positionV></wp:anchor><wpg:wgp><a:xfrm><a:off x="0" y="0"/><a:ext cx="9129802" cy="1314450"/></a:xfrm><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="276045"/><a:ext cx="1238250" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><wps:wsp><wps:spPr><a:xfrm><a:off x="3062377" y="276045"/><a:ext cx="6067425" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><pic:pic><a:blip r:embed="rId1"/><a:xfrm><a:off x="1371600" y="0"/><a:ext cx="1454785" cy="1314450"/></a:xfrm></pic:pic></wpg:wgp></w:drawing>'
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
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [{ id: 'r1', text: '', preservedXmlFragments: [group] }],
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
    expect(marginBandHeights(model).headerPx).toBe(109)
  })

  it('includes the Word header distance for a paragraph-relative letterhead', () => {
    const group =
      '<w:drawing><wp:anchor><wp:positionV relativeFrom="paragraph"><wp:posOffset>-280035</wp:posOffset></wp:positionV></wp:anchor><wpg:wgp><a:xfrm><a:off x="0" y="0"/><a:ext cx="9129802" cy="1314450"/></a:xfrm><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="276045"/><a:ext cx="1238250" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><wps:wsp><wps:spPr><a:xfrm><a:off x="3062377" y="276045"/><a:ext cx="6067425" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><pic:pic><a:blip r:embed="rId1"/><a:xfrm><a:off x="1371600" y="0"/><a:ext cx="1454785" cy="1314450"/></a:xfrm></pic:pic></wpg:wgp></w:drawing>'
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
          preservedXmlFragments: [
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2325" w:right="1797" w:bottom="2041" w:left="1797" w:header="708" w:footer="708"/></w:sectPr>',
          ],
        },
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [{ id: 'r1', text: '', preservedXmlFragments: [group] }],
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
    expect(marginBandHeights(model).headerPx).toBe(156)
  })
})

describe('footerBandFill', () => {
  it('reads a leftover shape fill', () => {
    expect(
      footerBandFill(
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f1',
              runs: [
                {
                  id: 's1',
                  text: '',
                  preservedXmlFragments: [
                    '<w:drawing><a:solidFill><a:srgbClr val="3A3A3A"/></a:solidFill></w:drawing>',
                  ],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
        [],
      ),
    ).toBe('#3A3A3A')
  })
})

describe('paragraphTabStops', () => {
  it('reads centre and right stops in twips', () => {
    expect(
      paragraphTabStops({
        id: 'p1',
        runs: [],
        preservedXmlFragments: [
          '<w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs></w:pPr>',
        ],
      }),
    ).toEqual([
      { val: 'center', posPx: 301 },
      { val: 'right', posPx: 602 },
    ])
  })
})
