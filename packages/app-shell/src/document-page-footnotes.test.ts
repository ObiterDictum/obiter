import '@obiter/test-dom'
import { expect, it } from 'bun:test'
import { createSyntheticDocx, parseDocx } from '@obiter/ooxml'
import { layoutDocument } from './document-page-engine'
import { clearParagraphMeasureCache } from './document-page-measure'
import { clearLineBreakCache } from './document-page-flow'
import { pageReferenceMap } from './document-page-references'
import { storyBlocks } from './document-page-tables'

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

it('anchors a reference at paragraph end to the last fragment rather than every fragment', async () => {
  const model = await noteModel()
  const paragraph = model.stories.find((story) => story.kind === 'document')
    ?.paragraphs[0]
  const first = paragraph?.runs[0]
  if (!first || !paragraph) throw new Error('Missing synthetic paragraph')
  first.text = 'long body '.repeat(500)
  const pages = layoutDocument(model)
  const lastFragmentPage = pages.reduce(
    (last, page, index) =>
      page.blocks.some(
        (block) =>
          block.type === 'paragraph' && block.paragraph.id === paragraph.id,
      )
        ? index
        : last,
    -1,
  )
  expect(lastFragmentPage).toBeGreaterThan(0)
  expect(pages.findIndex((page) => page.footnotes)).toBe(lastFragmentPage)
})

it('keeps page references to footnote bookmarks after notes leave the body block list', async () => {
  const model = await noteModel()
  const note = model.stories.find((story) => story.kind === 'footnotes')
    ?.paragraphs[0]
  if (!note) throw new Error('Missing synthetic note')
  note.preservedXmlFragments.push(
    '<w:bookmarkStart w:id="1" w:name="NoteBookmark"/>',
  )
  expect(
    pageReferenceMap(model, layoutDocument(model)).get('NoteBookmark'),
  ).toBe(1)
})

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

it('returns the latest note pages after eight unstable reservations instead of throwing', async () => {
  const model = await noteModel()
  let reads = 0
  const drafts = {
    get 'note-run'() {
      reads += 1
      return reads % 2 ? 'Short note' : 'Expanded note '.repeat(30)
    },
  }
  const pages = layoutDocument(model, drafts)
  expect(reads).toBe(8)
  expect(pages.length).toBeGreaterThan(0)
  expect(
    pages[0]?.footnotes?.blocks.some(
      (block) =>
        block.type === 'paragraph' &&
        block.paragraph.runs[0]?.text === 'Expanded note '.repeat(30),
    ),
  ).toBe(true)
})

it('matches a cold layout after warm body edits grow, shrink, split, or move a reference', async () => {
  const model = await noteModel()
  const body = model.stories.find((story) => story.kind === 'document')
  const run = body?.paragraphs[0]?.runs[0]
  if (!run || !body) throw new Error('Missing reference run')
  layoutDocument(model)
  for (const blocks of [undefined, storyBlocks(body)]) {
    for (const text of [
      'Claim!',
      'Claim?',
      'Long body '.repeat(300),
      'Claim',
      '',
    ]) {
      const drafts = { [run.id]: text }
      expect(layoutDocument(model, drafts, [], {}, blocks)).toEqual(
        layoutDocument(structuredClone(model), drafts),
      )
    }
  }
})

it('preserves trailing note-only pages when reusing an unchanged reservation', async () => {
  const model = await noteModel()
  const drafts = { 'note-run': 'Long note '.repeat(400) }
  layoutDocument(model, drafts)
  expect(layoutDocument(model, drafts)).toEqual(
    layoutDocument(structuredClone(model), drafts),
  )
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

it('reserves twelve pixels above the separator plus its pixel and an eight pixel note gap', async () => {
  const model = await noteModel()
  const band = layoutDocument(model).find((page) => page.footnotes)?.footnotes
  expect(band).toBeDefined()
  expect(band?.heightPx).toBeCloseTo(40 / 3 + 21)
})
