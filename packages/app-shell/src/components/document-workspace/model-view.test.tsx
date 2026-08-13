// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import { layoutDocument } from '../../document-page-engine'
import { DocumentModelPage } from './model-view'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [
            {
              id: 'r1',
              text: 'Alice Example overview',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: ['<w:bookmarkStart w:id="1"/>'],
        },
      ],
      preservedXmlFragments: [],
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [
    {
      id: 'c1',
      kind: 'insert',
      elementName: 'ins',
      text: 'Alice',
      storyPartName: 'word/document.xml',
      runId: 'r1',
      paragraphId: 'p1',
    },
  ],
}

afterEach(() => {
  cleanup()
})

describe('DocumentModelPage', () => {
  it('renders run text and never the preserved XML', () => {
    render(
      <DocumentModelPage
        model={model}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )

    expect(screen.getByText('Alice Example overview')).toBeTruthy()
    expect(screen.queryByText('Unmodelled content')).toBeNull()
    expect(screen.queryByText('<w:bookmarkStart w:id="1"/>')).toBeNull()
    expect(screen.queryByRole('img', { name: 'Header image' })).toBeNull()
  })

  it('places header and footer text in the page margins', () => {
    const paged: DocumentModelWire = {
      ...model,
      stories: [
        ...model.stories,
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [
                {
                  id: 'hr1',
                  text: 'Acme LLP',
                  preservedXmlFragments: [],
                },
              ],
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
              runs: [
                {
                  id: 'fr1',
                  text: 'Confidential',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={paged}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByLabelText('Document header').textContent).toContain(
      'Acme LLP',
    )
    expect(screen.getByLabelText('Document footer').textContent).toContain(
      'Confidential',
    )
    const body = screen.getByLabelText('Document body')
    const header = screen.getByLabelText('Document header')
    const footer = screen.getByLabelText('Document footer')
    expect(body.className).toContain('overflow-clip')
    expect(Number.parseFloat(body.style.height)).toBeGreaterThan(0)
    expect(Number.parseFloat(header.style.height)).toBeGreaterThan(0)
    expect(Number.parseFloat(footer.style.height)).toBeGreaterThan(0)
    expect(
      Number.parseFloat(header.style.height) +
        Number.parseFloat(body.style.height) +
        Number.parseFloat(footer.style.height),
    ).toBe(Number.parseFloat(body.parentElement?.style.height ?? ''))
  })

  it('shows a labelled image slot for image-only headers', () => {
    const drawing =
      '<w:drawing><wp:inline><wp:extent cx="1714500" cy="457200"/><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
    const imaged: DocumentModelWire = {
      ...model,
      relationships: [
        {
          sourcePartName: 'word/header1.xml',
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
          target: 'media/image1.png',
          sourceFragment: '',
        },
      ],
      stories: [
        ...model.stories,
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [
                {
                  id: 'hr1',
                  text: '',
                  preservedXmlFragments: [drawing],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={imaged}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByRole('img', { name: 'Header image' })).toBeTruthy()
    expect(screen.queryByText('Unmodelled content')).toBeNull()
    expect(screen.queryByText(drawing)).toBeNull()
  })

  it('paints the header picture when its media URL is available', () => {
    const drawing =
      '<w:drawing><wp:inline><wp:extent cx="7560310" cy="1143000"/><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
    const imaged: DocumentModelWire = {
      ...model,
      relationships: [
        {
          sourcePartName: 'word/header1.xml',
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
          target: 'media/image1.png',
          sourceFragment: '',
        },
      ],
      stories: [
        ...model.stories,
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [
                {
                  id: 'hr1',
                  text: '',
                  preservedXmlFragments: [drawing],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    const { container } = render(
      <DocumentModelPage
        model={imaged}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
        imageUrls={{ 'word/media/image1.png': 'data:image/png;base64,aaa' }}
      />,
    )
    const image = container.querySelector('img')
    expect(image?.getAttribute('src')).toBe('data:image/png;base64,aaa')
    expect(image?.style.width).toBe('794px')
    expect(image?.style.height).toBe('120px')
    expect(screen.queryByText('Header image')).toBeNull()
  })

  it('keeps a letterhead logo in the centre of a three-cell header bar', () => {
    const drawing =
      '<w:drawing><wp:inline><wp:extent cx="1714500" cy="1714500"/><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
    const xml =
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:fill="A6A6A6"/></w:tcPr><w:p w14:paraId="LEFT0001"/></w:tc><w:tc><w:p w14:paraId="MID00002"><w:r><w:drawing><wp:inline><a:blip r:embed="rId1"/></wp:inline></w:drawing></w:r></w:p></w:tc><w:tc><w:tcPr><w:shd w:fill="A6A6A6"/></w:tcPr><w:p w14:paraId="RIGHT001"/></w:tc></w:tr></w:tbl>'
    const letterhead: DocumentModelWire = {
      ...model,
      relationships: [
        {
          sourcePartName: 'word/header1.xml',
          id: 'rId1',
          type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
          target: 'media/image1.png',
          sourceFragment: '',
        },
      ],
      stories: [
        ...model.stories,
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'para-header-logo',
              runs: [
                {
                  id: 'hr1',
                  text: '',
                  preservedXmlFragments: [drawing],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [xml],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={letterhead}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
        imageUrls={{ 'word/media/image1.png': 'data:image/png;base64,aaa' }}
      />,
    )
    const header = screen.getByLabelText('Document header')
    const cells = header.querySelectorAll('td')
    expect(cells).toHaveLength(3)
    expect(cells[0]?.style.backgroundColor).toMatch(/a6a6a6|166/i)
    expect(cells[2]?.style.backgroundColor).toMatch(/a6a6a6|166/i)
    expect(cells[1]?.querySelector('img')?.style.width).toBe('180px')
    expect(cells[1]?.querySelector('img')?.style.height).toBe('180px')
  })

  it('keeps body text below the header exclusion zone', () => {
    const group =
      '<w:drawing><wp:anchor><wp:positionV relativeFrom="paragraph"><wp:posOffset>-280035</wp:posOffset></wp:positionV></wp:anchor><wpg:wgp><a:xfrm><a:off x="0" y="0"/><a:ext cx="9129802" cy="1314450"/></a:xfrm><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="276045"/><a:ext cx="1238250" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><wps:wsp><wps:spPr><a:xfrm><a:off x="3062377" y="276045"/><a:ext cx="6067425" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><pic:pic><a:blip r:embed="rId1"/><a:xfrm><a:off x="1371600" y="0"/><a:ext cx="1454785" cy="1314450"/></a:xfrm></pic:pic></wpg:wgp></w:drawing>'
    const document = model.stories[0]
    if (!document) throw new Error('expected document story')
    const paged: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...document,
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
    }
    render(
      <DocumentModelPage
        model={paged}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    const header = screen.getByLabelText('Document header')
    const body = screen.getByLabelText('Document body')
    const footer = screen.getByLabelText('Document footer')
    const headerPx = Number.parseFloat(header.style.height)
    expect(headerPx).toBe(156)
    expect(header.compareDocumentPosition(body)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(
      headerPx +
        Number.parseFloat(body.style.height) +
        Number.parseFloat(footer.style.height),
    ).toBe(1123)
    expect(header.style.backgroundColor).toBe('')
    expect(header.querySelectorAll('[aria-hidden="true"]').length).toBe(2)
  })

  it('keeps table cell text in a table instead of a flat list', () => {
    const tableXml =
      '<w:tbl><w:tr><w:tc><w:p w14:paraId="AABBCCDD"><w:r><w:t>Particulars</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="EEFF0011"><w:r><w:t>Details</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    const tabled: DocumentModelWire = {
      ...model,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'para-w14-AABBCCDD',
              runs: [
                {
                  id: 'r1',
                  text: 'Particulars',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [],
            },
            {
              id: 'para-w14-EEFF0011',
              runs: [
                {
                  id: 'r2',
                  text: 'Details',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [tableXml],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={tabled}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByText('Particulars').closest('table')).toBeTruthy()
    expect(screen.getByText('Details').closest('td')).toBeTruthy()
  })

  it('keeps white footer text readable when the dark bar is missing', () => {
    const footed: DocumentModelWire = {
      ...model,
      stories: [
        ...model.stories,
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f1',
              runs: [
                {
                  id: 'fr1',
                  text: 'Company Registration Number 123',
                  preservedXmlFragments: [
                    '<w:rPr><w:color w:val="FFFFFF"/></w:rPr>',
                  ],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={footed}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    const text = screen.getByText('Company Registration Number 123')
    expect(text).toBeTruthy()
    expect(text.getAttribute('style') ?? '').not.toContain('rgb(255, 255, 255)')
    expect(text.getAttribute('style') ?? '').not.toContain('#FFFFFF')
  })

  it('paints a shape fill instead of a footer image label', () => {
    const shape =
      '<w:drawing><wp:extent cx="7560310" cy="457200"/><a:solidFill><a:srgbClr val="3A3A3A"/></a:solidFill></w:drawing>'
    const shaped: DocumentModelWire = {
      ...model,
      stories: [
        ...model.stories,
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f1',
              runs: [
                {
                  id: 'fr1',
                  text: '',
                  preservedXmlFragments: [shape],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={shaped}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.queryByText('Footer image')).toBeNull()
    expect(screen.getByLabelText('Document footer')).toBeTruthy()
  })

  it('types headings as page styles instead of dumping the style id', () => {
    const headingModel: DocumentModelWire = {
      ...model,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              styleId: 'Heading1',
              runs: [
                {
                  id: 'r1',
                  text: 'Parties',
                  preservedXmlFragments: [],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={headingModel}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByText('Parties')).toBeTruthy()
    expect(screen.queryByText('Heading1')).toBeNull()
  })

  it('renders only the first footer when the section does not name one', () => {
    const doubled: DocumentModelWire = {
      ...model,
      stories: [
        ...model.stories,
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f1',
              runs: [
                { id: 'a', text: 'Alpha footer', preservedXmlFragments: [] },
              ],
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
              runs: [
                { id: 'b', text: 'Beta footer', preservedXmlFragments: [] },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={doubled}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByLabelText('Document footer').textContent).toContain(
      'Alpha footer',
    )
    expect(screen.queryByText('Beta footer')).toBeNull()
  })

  it('lays footer tab stops out as columns and shows a PAGE field', () => {
    const footed: DocumentModelWire = {
      ...model,
      stories: [
        ...model.stories,
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'f1',
              runs: [
                { id: 'a', text: 'phone', preservedXmlFragments: [] },
                { id: 't', text: '', preservedXmlFragments: ['<w:tab/>'] },
                {
                  id: 'p',
                  text: '',
                  preservedXmlFragments: [
                    '<w:instrText xml:space="preserve"> PAGE </w:instrText>',
                  ],
                },
                { id: 'u', text: '', preservedXmlFragments: ['<w:tab/>'] },
                { id: 'c', text: 'www.example.com', preservedXmlFragments: [] },
              ],
              preservedXmlFragments: [
                '<w:pPr><w:tabs><w:tab w:val="center" w:pos="4513"/><w:tab w:val="right" w:pos="9026"/></w:tabs></w:pPr>',
              ],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={footed}
        pageNumber={2}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    const footer = screen.getByLabelText('Document footer')
    expect(footer.textContent).toContain('phone')
    expect(footer.textContent).toContain('2')
    expect(footer.textContent).toContain('www.example.com')
    expect(
      footer.querySelector('[style*="translateX"]')?.parentElement?.children,
    ).toHaveLength(3)
  })

  it('paints header grey flanks around a logo when the table is missing', () => {
    const logo =
      '<w:drawing><wp:inline><wp:extent cx="1714500" cy="457200"/><a:blip r:embed="rId1"/></wp:inline></w:drawing>'
    const headed: DocumentModelWire = {
      ...model,
      stories: [
        ...model.stories,
        {
          partName: 'word/header1.xml',
          kind: 'header',
          paragraphs: [
            {
              id: 'h1',
              runs: [{ id: 'hr1', text: '', preservedXmlFragments: [logo] }],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={headed}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    const header = screen.getByLabelText('Document header')
    expect(header.querySelector('[aria-label="Header image"]')).toBeTruthy()
    const flanks = [...header.querySelectorAll('div')].filter((node) => {
      const style = node.getAttribute('style') ?? ''
      return style.includes('#A6A6A6') || style.includes('166, 166, 166')
    })
    expect(flanks.length).toBeGreaterThanOrEqual(2)
  })

  it('puts footer text on the shape fill instead of above it', () => {
    const shape =
      '<w:drawing><wp:extent cx="7560310" cy="457200"/><a:solidFill><a:srgbClr val="3A3A3A"/></a:solidFill></w:drawing>'
    const footed: DocumentModelWire = {
      ...model,
      stories: [
        ...model.stories,
        {
          partName: 'word/footer1.xml',
          kind: 'footer',
          paragraphs: [
            {
              id: 'shape',
              runs: [{ id: 's1', text: '', preservedXmlFragments: [shape] }],
              preservedXmlFragments: [],
            },
            {
              id: 'f1',
              runs: [
                {
                  id: 'fr1',
                  text: 'www.arthaum.com',
                  preservedXmlFragments: [
                    '<w:rPr><w:color w:val="FFFFFF"/></w:rPr>',
                  ],
                },
              ],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={footed}
        pageNumber={2}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    const footer = screen.getByLabelText('Document footer')
    expect(footer.textContent).toContain('www.arthaum.com')
    expect(footer.textContent).toContain('2')
    expect(screen.queryByText('Footer image')).toBeNull()
    expect(footer.innerHTML).toMatch(/rgb\(58, 58, 58\)|#3A3A3A/i)
  })

  it('renders only the supplied page blocks', () => {
    const first = model.stories[0]
    if (!first) throw new Error('expected document story')
    const second = {
      id: 'p2',
      runs: [
        {
          id: 'r2',
          text: 'Second page body',
          preservedXmlFragments: [],
        },
      ],
      preservedXmlFragments: [],
    }
    const paged: DocumentModelWire = {
      ...model,
      stories: [{ ...first, paragraphs: [...first.paragraphs, second] }],
    }
    render(
      <DocumentModelPage
        model={paged}
        pageBlocks={[{ type: 'paragraph', paragraph: second }]}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByText('Second page body')).toBeTruthy()
    expect(screen.queryByText('Alice Example overview')).toBeNull()
  })

  it('renders a paragraph slice when the layout splits a page', () => {
    const first = model.stories[0]?.paragraphs[0]
    if (!first) throw new Error('expected paragraph')
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[{ type: 'paragraph', paragraph: first, from: 0, to: 5 }]}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByText('Alice')).toBeTruthy()
    expect(screen.queryByText('Alice Example overview')).toBeNull()
  })

  it('keeps the typing caret on the page slice that can hold it', () => {
    const first = model.stories[0]?.paragraphs[0]
    if (!first) throw new Error('expected paragraph')
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[
          { type: 'paragraph', paragraph: first, from: 0, to: 5 },
          { type: 'paragraph', paragraph: first, from: 5, to: 22 },
        ]}
        selectedParagraphId="p1"
        restoreCaret={{ paragraphId: 'p1', offset: 5 }}
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    const fields = screen.getAllByLabelText(
      'Paragraph text',
    ) as HTMLTextAreaElement[]
    expect(fields).toHaveLength(1)
    expect(fields[0]?.value).toBe(' Example overview')
  })

  it('inserts a new paragraph when Enter is pressed in a run', () => {
    const inserted: string[] = []
    render(
      <DocumentModelPage
        model={model}
        selectedParagraphId="p1"
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={() => undefined}
        onInsertParagraph={(id) => inserted.push(id)}
      />,
    )
    fireEvent.keyDown(screen.getByLabelText('Paragraph text'), { key: 'Enter' })
    expect(inserted).toEqual(['p1'])
  })

  it('places a caret on the first page click so Enter can insert a paragraph', () => {
    const inserted: string[] = []
    function Harness() {
      const [selected, setSelected] = useState<string | null>(null)
      const [caret, setCaret] = useState<{
        paragraphId: string
        offset: number
      } | null>(null)
      return (
        <DocumentModelPage
          model={model}
          selectedParagraphId={selected}
          restoreCaret={caret}
          onSelectParagraph={(id, offset) => {
            setSelected(id)
            setCaret(offset == null ? null : { paragraphId: id, offset })
          }}
          editing
          onRunTextChange={() => undefined}
          onInsertParagraph={(id) => inserted.push(id)}
        />
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByLabelText('Document body'))
    const field = screen.getByLabelText('Paragraph text')
    expect(document.activeElement).toBe(field)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(inserted).toEqual(['p1'])
  })

  it('selects a paragraph when its run is focused', () => {
    const selected: string[] = []
    render(
      <DocumentModelPage
        model={model}
        selectedParagraphId={null}
        onSelectParagraph={(id) => selected.push(id)}
        editing
        onRunTextChange={() => undefined}
      />,
    )
    fireEvent.focus(screen.getByLabelText('Paragraph text'))
    expect(selected).toEqual(['p1'])
  })

  it('deletes an empty run paragraph on Backspace', () => {
    const deleted: string[] = []
    const story = model.stories[0]
    if (!story) throw new Error('expected story')
    const empty: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...story,
          paragraphs: [
            {
              id: 'p1',
              runs: [{ id: 'r1', text: '', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          ],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={empty}
        selectedParagraphId="p1"
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={() => undefined}
        onDeleteParagraph={(id) => deleted.push(id)}
      />,
    )
    fireEvent.keyDown(screen.getByLabelText('Paragraph text'), {
      key: 'Backspace',
    })
    expect(deleted).toEqual(['p1'])
  })

  it('deletes an empty pending paragraph on Backspace and does not paint a side bar', () => {
    const deleted: string[] = []
    const insert = { clientId: 'ins1', afterParagraphId: 'p1', text: '' }
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[
          {
            type: 'paragraph',
            paragraph: {
              id: 'ins1',
              runs: [{ id: 'ins1', text: '', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          },
        ]}
        inserts={[insert]}
        selectedParagraphId="ins1"
        onSelectParagraph={() => undefined}
        onDeleteParagraph={(id) => deleted.push(id)}
      />,
    )
    const pending = screen.getByLabelText('Pending paragraph')
    expect(pending.className).not.toMatch(/shadow/)
    fireEvent.keyDown(screen.getByLabelText('Pending paragraph text'), {
      key: 'Backspace',
    })
    expect(deleted).toEqual(['ins1'])
  })

  it('leaves a pending paragraph with text in place on Backspace away from the start', () => {
    const deleted: string[] = []
    const joined: string[] = []
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[
          {
            type: 'paragraph',
            paragraph: {
              id: 'ins1',
              runs: [{ id: 'ins1', text: 'Hello', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          },
        ]}
        inserts={[{ clientId: 'ins1', afterParagraphId: 'p1', text: 'Hello' }]}
        selectedParagraphId="ins1"
        onSelectParagraph={() => undefined}
        onDeleteParagraph={(id) => deleted.push(id)}
        onJoinPrevious={(id) => {
          joined.push(id)
        }}
      />,
    )
    const field = screen.getByLabelText(
      'Pending paragraph text',
    ) as HTMLTextAreaElement
    field.setSelectionRange(5, 5)
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(deleted).toEqual([])
    expect(joined).toEqual([])
  })

  it('joins a pending paragraph into the previous one on Backspace at the start', () => {
    const joined: string[] = []
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[
          {
            type: 'paragraph',
            paragraph: {
              id: 'ins1',
              runs: [{ id: 'ins1', text: 'Hello', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          },
        ]}
        inserts={[{ clientId: 'ins1', afterParagraphId: 'p1', text: 'Hello' }]}
        selectedParagraphId="ins1"
        onSelectParagraph={() => undefined}
        onJoinPrevious={(id) => {
          joined.push(id)
        }}
      />,
    )
    const field = screen.getByLabelText(
      'Pending paragraph text',
    ) as HTMLTextAreaElement
    field.setSelectionRange(0, 0)
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(joined).toEqual(['ins1'])
  })

  it('joins a paragraph into the previous one on Backspace at the start', () => {
    const story = model.stories[0]
    if (!story) throw new Error('expected story')
    const joined: string[] = []
    const two: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...story,
          paragraphs: [
            {
              id: 'p1',
              runs: [{ id: 'r1', text: 'Hello', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
            {
              id: 'p2',
              runs: [{ id: 'r2', text: 'World', preservedXmlFragments: [] }],
              preservedXmlFragments: [],
            },
          ],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={two}
        selectedParagraphId="p2"
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={() => undefined}
        onJoinPrevious={(id) => {
          joined.push(id)
        }}
      />,
    )
    const fields = screen.getAllByLabelText(
      'Paragraph text',
    ) as HTMLTextAreaElement[]
    const field = fields[1]
    if (!field) throw new Error('expected second paragraph')
    field.setSelectionRange(0, 0)
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(joined).toEqual(['p2'])
  })

  it('deletes the previous run character on Backspace at the start of a later run', () => {
    const story = model.stories[0]
    if (!story) throw new Error('expected story')
    const drafts: Record<string, string> = {}
    const linked: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...story,
          paragraphs: [
            {
              id: 'p1',
              runs: [
                { id: 'r1', text: 'with ', preservedXmlFragments: [] },
                { id: 'r2', text: 'Acme', preservedXmlFragments: [] },
              ],
              preservedXmlFragments: [],
            },
          ],
        },
      ],
    }
    render(
      <DocumentModelPage
        model={linked}
        selectedParagraphId="p1"
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={(runId, text) => {
          drafts[runId] = text
        }}
      />,
    )
    const field = screen.getByLabelText('Paragraph text') as HTMLTextAreaElement
    field.setSelectionRange(5, 5)
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(drafts).toEqual({ r1: 'with' })
  })

  it('keeps a page-split fragment editable and splices the slice back into the run', () => {
    const first = model.stories[0]?.paragraphs[0]
    if (!first) throw new Error('expected paragraph')
    const drafts: Record<string, string> = {}
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[{ type: 'paragraph', paragraph: first, from: 6, to: 22 }]}
        selectedParagraphId="p1"
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={(runId, text) => {
          drafts[runId] = text
        }}
      />,
    )
    const field = screen.getByLabelText('Paragraph text') as HTMLTextAreaElement
    expect(field.value).toBe('Example overview')
    fireEvent.change(field, { target: { value: 'Example note' } })
    expect(drafts).toEqual({ r1: 'Alice Example note' })
  })

  it('deletes the character before a continuation slice on Backspace at the start', () => {
    const first = model.stories[0]?.paragraphs[0]
    if (!first) throw new Error('expected paragraph')
    const drafts: Record<string, string> = {}
    render(
      <DocumentModelPage
        model={model}
        pageBlocks={[{ type: 'paragraph', paragraph: first, from: 6, to: 22 }]}
        selectedParagraphId="p1"
        onSelectParagraph={() => undefined}
        editing
        onRunTextChange={(runId, text) => {
          drafts[runId] = text
        }}
      />,
    )
    const field = screen.getByLabelText('Paragraph text') as HTMLTextAreaElement
    field.setSelectionRange(0, 0)
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(drafts).toEqual({ r1: 'AliceExample overview' })
  })

  it('paints list markers and footnote marks from the model', () => {
    const listed: DocumentModelWire = {
      ...model,
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
          ],
        },
      ],
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              runs: [
                {
                  id: 'r1',
                  text: 'Alice Example overview',
                  preservedXmlFragments: ['<w:footnoteReference w:id="1"/>'],
                },
              ],
              preservedXmlFragments: [
                '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
              ],
            },
          ],
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
            '<w:footnote w:id="1"><w:p><w:r><w:t>Alice Example footnote</w:t></w:r></w:p></w:footnote>',
          ],
        },
      ],
    }
    const pages = layoutDocument(listed)
    render(
      <DocumentModelPage
        model={listed}
        pageBlocks={pages[0]?.blocks}
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    expect(screen.getByText('1.')).toBeTruthy()
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)
    expect(screen.getByText('Alice Example footnote')).toBeTruthy()
  })
})
