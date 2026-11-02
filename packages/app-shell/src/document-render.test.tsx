import '@obiter/test-dom'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'
import {
  applyRunTextReplacementRange,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import { StaticDocumentPages, layoutDocumentPages } from './document-render'

afterEach(cleanup)

async function blackBarModel() {
  const parsed = await parseDocx(await createSyntheticDocx(['[REDACTED]']))
  const story = parsed.model.stories.find((item) => item.kind === 'document')
  const paragraph = story?.paragraphs[0]
  const anchor = paragraph && parsed.paragraphAnchors.get(paragraph.id)
  if (!anchor) throw new Error('synthetic document has no paragraph anchor')
  applyRunTextReplacementRange(parsed, anchor, [
    {
      from: 0,
      to: '[REDACTED]'.length,
      text: '[REDACTED]',
      emphasis: { highlight: 'black', colour: '000000' },
    },
  ])
  return (await parseDocx(await serialiseDocx(parsed))).model
}

describe('StaticDocumentPages', () => {
  it('paints one sheet per laid-out page', async () => {
    const parsed = await parseDocx(await createSyntheticDocx(['Hello page']))
    const pages = layoutDocumentPages(parsed.model)
    const { container } = render(
      <StaticDocumentPages model={parsed.model} pages={pages} />,
    )
    expect(container.querySelectorAll('[data-document-sheet]')).toHaveLength(
      pages.length,
    )
  })

  it('prints section-specific margins and a separate footnote band on the reference page', async () => {
    const { model } = await parseDocx(
      await createSyntheticDocx(['First claim', 'Second section']),
    )
    const story = model.stories.find((item) => item.kind === 'document')
    const first = story?.paragraphs[0]
    const run = first?.runs[0]
    if (!story || !first || !run)
      throw new Error('Missing synthetic paragraphs')
    first.preservedXmlFragments.push(
      '<w:sectPr><w:headerReference w:type="default" r:id="h1"/></w:sectPr>',
    )
    story.preservedXmlFragments = [
      '<w:sectPr><w:headerReference w:type="default" r:id="h2"/></w:sectPr>',
    ]
    run.preservedXmlFragments.push('<w:footnoteReference w:id="1"/>')
    for (const n of [1, 2]) {
      model.stories.push({
        ...story,
        kind: 'header',
        partName: `word/header${n}.xml`,
        preservedXmlFragments: [],
        paragraphs: [
          {
            id: `header${n}`,
            runs: [
              {
                id: `header-run${n}`,
                text: `Section ${n} header`,
                preservedXmlFragments: [],
              },
            ],
            preservedXmlFragments: [],
          },
        ],
      })
      model.relationships.push({
        id: `h${n}`,
        sourcePartName: 'word/document.xml',
        type: 'header',
        target: `header${n}.xml`,
        sourceFragment: '',
      })
    }
    model.stories.push({
      ...story,
      kind: 'footnotes',
      partName: 'word/footnotes.xml',
      preservedXmlFragments: ['<w:footnote w:id="1"><w:p/></w:footnote>'],
      paragraphs: [
        {
          id: 'note',
          runs: [
            {
              id: 'note-run',
              text: 'Supporting note',
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    })
    const { container } = render(
      <StaticDocumentPages model={model} pages={layoutDocumentPages(model)} />,
    )
    const sheets = container.querySelectorAll('[data-document-sheet]')
    expect(sheets).toHaveLength(2)
    expect(sheets[0]?.textContent).toContain('Section 1 header')
    expect(sheets[0]?.textContent).not.toContain('Section 2 header')
    expect(sheets[1]?.textContent).toContain('Section 2 header')
    expect(
      sheets[0]?.querySelector('[aria-label="Page footnotes"]')?.textContent,
    ).toContain('Supporting note')
    expect(sheets[1]?.textContent).not.toContain('Supporting note')
  })

  it('paints black-bar emphasis as opaque black', async () => {
    const model = await blackBarModel()
    render(
      <StaticDocumentPages model={model} pages={layoutDocumentPages(model)} />,
    )
    const run = screen.getByText('[REDACTED]')
    expect(run.style.backgroundColor).toBe('rgb(0, 0, 0)')
    expect(run.style.color).toBe('rgb(0, 0, 0)')
  })
})
