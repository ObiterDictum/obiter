import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'
import { createBlankDocx } from './blank'
import { applyDocumentEdits } from './model-edits'
import { loadOoxmlZipEntries } from './package-loader'
import { parseDocx } from './parse'
import { serialiseDocx } from './serialise'

const STYLE_IDS = [
  'Normal',
  'Heading1',
  'Heading2',
  'Heading3',
  'Title',
  'Quote',
  'ListParagraph',
]

describe('createBlankDocx', () => {
  it('parses to a document story with one empty paragraph', async () => {
    const document = await parseDocx(await createBlankDocx())
    const story = document.model.stories.find(
      (item) => item.kind === 'document',
    )
    expect(story?.paragraphs).toHaveLength(1)
    expect(story?.paragraphs[0]?.runs[0]?.text).toBe('')
  })

  it('carries the paragraph styles a new document can apply', async () => {
    const document = await parseDocx(await createBlankDocx())
    const styleIds = document.model.styles.map((style) => style.styleId)
    for (const styleId of STYLE_IDS) {
      expect(styleIds).toContain(styleId)
    }
  })

  it('defines a bullet list, a numbered list and a multilevel legal list', async () => {
    const document = await parseDocx(await createBlankDocx())
    const shapes = document.model.numbering.map((instance) =>
      (instance.levels ?? []).map((level) => level.numFmt),
    )
    expect(shapes).toEqual(
      expect.arrayContaining([
        ['bullet'],
        ['decimal'],
        ['decimal', 'decimal', 'decimal'],
      ]),
    )
    const multilevel = document.model.numbering.find(
      (instance) => instance.levels?.length === 3,
    )
    expect(multilevel?.levels?.map((level) => level.lvlText)).toEqual([
      '%1.',
      '%1.%2.',
      '%1.%2.%3.',
    ])
  })

  it('keeps a heading style and a bullet list through save and reparse', async () => {
    const document = await parseDocx(await createBlankDocx())
    const paragraph = document.model.stories.find(
      (item) => item.kind === 'document',
    )?.paragraphs[0]
    if (!paragraph) throw new Error('Expected a body paragraph.')

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_style',
        paragraphId: paragraph.id,
        styleId: 'Heading1',
      },
      {
        type: 'set_paragraph_numbering',
        paragraphId: paragraph.id,
        numId: '1',
        ilvl: 0,
      },
    ])

    const output = await serialiseDocx(document)
    const saved = await parseDocx(output)
    const reparsed = saved.model.stories.find(
      (item) => item.kind === 'document',
    )?.paragraphs[0]
    expect(reparsed?.styleId).toBe('Heading1')
    expect(reparsed?.preservedXmlFragments.join('')).toContain(
      '<w:numId w:val="1"/>',
    )
    expect(saved.model.styles.map((style) => style.styleId)).toEqual(
      expect.arrayContaining(STYLE_IDS),
    )
    expect(saved.model.numbering).toHaveLength(3)
  })

  it('serialises to a package the loader accepts with its styles and numbering parts', async () => {
    const document = await parseDocx(await createBlankDocx())
    const output = await serialiseDocx(document)
    const entries = await loadOoxmlZipEntries(output)
    expect(entries.has('word/styles.xml')).toBe(true)
    expect(entries.has('word/numbering.xml')).toBe(true)
    const zip = await JSZip.loadAsync(output)
    expect(zip.file('word/styles.xml')).not.toBeNull()
    expect(zip.file('word/numbering.xml')).not.toBeNull()
  })
})
