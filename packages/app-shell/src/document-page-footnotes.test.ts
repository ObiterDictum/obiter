import '@obiter/test-dom'
import { expect, it } from 'bun:test'
import { createSyntheticDocx, parseDocx } from '@obiter/ooxml'
import { layoutDocument } from './document-page-engine'
import { clearParagraphMeasureCache } from './document-page-measure'
import { clearLineBreakCache } from './document-page-flow'

async function noteModel() {
  const { model } = await parseDocx(
    await createSyntheticDocx([
      'Claim',
      ...Array.from({ length: 30 }, () => 'Body'),
    ]),
  )
  const story = model.stories.find((item) => item.kind === 'document')
  const paragraph = story?.paragraphs[0]
  if (!story || !paragraph) throw new Error('Missing synthetic body')
  story.preservedXmlFragments = [
    '<w:sectPr><w:pgSz w:w="11906" w:h="4000"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>',
  ]
  paragraph.runs.push({
    id: 'reference',
    text: '',
    preservedXmlFragments: ['<w:footnoteReference w:id="1"/>'],
  })
  model.stories.push({
    ...story,
    kind: 'footnotes',
    partName: 'word/footnotes.xml',
    paragraphs: [
      {
        id: 'note',
        runs: [
          { id: 'note-run', text: 'Short note', preservedXmlFragments: [] },
        ],
        preservedXmlFragments: [],
      },
    ],
    preservedXmlFragments: ['<w:footnote w:id="1"><w:p/></w:footnote>'],
  })
  return model
}

it('remeasures edited footnotes without reusing a previous note reservation', async () => {
  const model = await noteModel()
  const first = layoutDocument(model)
  const drafts = { 'note-run': 'Expanded note '.repeat(350) }
  const warm = layoutDocument(model, drafts)
  expect(warm.filter((page) => page.footnotes).length).toBeGreaterThan(
    first.filter((page) => page.footnotes).length,
  )
  clearParagraphMeasureCache()
  clearLineBreakCache()
  expect(layoutDocument(model, drafts)).toEqual(warm)
})

it('keeps endnotes at the document end while footnotes remain on reference pages', async () => {
  const model = await noteModel()
  const body = model.stories.find((story) => story.kind === 'document')
  const paragraph = body?.paragraphs[0]
  if (!body || !paragraph) throw new Error('Missing synthetic body')
  paragraph.runs.push({
    id: 'end-reference',
    text: '',
    preservedXmlFragments: ['<w:endnoteReference w:id="2"/>'],
  })
  model.stories.push({
    ...body,
    kind: 'endnotes',
    partName: 'word/endnotes.xml',
    paragraphs: [
      {
        id: 'endnote',
        runs: [
          { id: 'endnote-run', text: 'Endnote', preservedXmlFragments: [] },
        ],
        preservedXmlFragments: [],
      },
    ],
    preservedXmlFragments: ['<w:endnote w:id="2"><w:p/></w:endnote>'],
  })
  const pages = layoutDocument(model)
  expect(
    pages[0]?.footnotes?.blocks.some(
      (block) => block.type === 'paragraph' && block.paragraph.id === 'note',
    ),
  ).toBe(true)
  const blocks = pages.flatMap((page) => page.blocks)
  const last = blocks[blocks.length - 1]
  expect(last?.type === 'paragraph' ? last.paragraph.id : undefined).toBe(
    'endnote',
  )
})

it('keeps web-flow footnotes in the continuous document rather than a page-bottom band', async () => {
  const model = await noteModel()
  const pages = layoutDocument(model, undefined, [], {}, undefined, [], {
    kind: 'web',
    widthPx: 600,
  })
  expect(pages).toHaveLength(1)
  expect(pages[0]?.footnotes).toBeUndefined()
  expect(
    pages[0]?.blocks.some(
      (block) => block.type === 'paragraph' && block.paragraph.id === 'note',
    ),
  ).toBe(true)
})
