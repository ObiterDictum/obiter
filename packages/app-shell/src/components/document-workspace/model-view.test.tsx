// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
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
              runs: [{ id: 'a', text: 'Alpha footer', preservedXmlFragments: [] }],
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
              runs: [{ id: 'b', text: 'Beta footer', preservedXmlFragments: [] }],
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
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    const footer = screen.getByLabelText('Document footer')
    expect(footer.textContent).toContain('phone')
    expect(footer.textContent).toContain('1')
    expect(footer.textContent).toContain('www.example.com')
    expect(footer.querySelector('[style*="translateX"]')?.parentElement?.children).toHaveLength(3)
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
        selectedParagraphId={null}
        onSelectParagraph={() => undefined}
      />,
    )
    const footer = screen.getByLabelText('Document footer')
    expect(footer.textContent).toContain('www.arthaum.com')
    expect(screen.queryByText('Footer image')).toBeNull()
    expect(footer.innerHTML).toMatch(/rgb\(58, 58, 58\)|#3A3A3A/i)
  })
})
