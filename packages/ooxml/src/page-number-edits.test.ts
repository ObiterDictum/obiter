import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

const TRACKING = { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' }

const FIELD =
  /<w:r><w:fldChar w:fldCharType="begin"\/><\/w:r>[\s\S]*?<w:fldChar w:fldCharType="end"\/><\/w:r>/u

describe('page-number edits', () => {
  it('splices a PAGE field into a footer part at the caret', async () => {
    const document = await parseFixture()
    const anchor = storyParagraphs(document, 'word/footer2.xml')[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_page_number', paragraphId: anchor.id, offset: 7 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/footer2.xml')

    const field = xml.match(FIELD)?.[0]
    expect(field).toContain(
      '<w:instrText xml:space="preserve"> PAGE </w:instrText>',
    )
    expect(field).toContain('w:fldCharType="separate"')
    // The field splits 'Second footer' at offset 7: 'Second ' then 'footer'.
    expect(xml.indexOf('Second ')).toBeLessThan(
      xml.indexOf('fldCharType="begin"'),
    )
    expect(xml).toContain('footer')

    const reparsed = storyParagraphs(
      await parseDocx(output),
      'word/footer2.xml',
    )[0]
    expect(reparsed?.runs.map((run) => run.text).join('')).toBe('Second footer')
    expect(
      reparsed?.runs.some((run) =>
        run.preservedXmlFragments.some(
          (fragment) =>
            fragment.includes('instrText') && fragment.includes('PAGE'),
        ),
      ),
    ).toBe(true)
    expect(
      reparsed?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="begin"'),
        ),
      ),
    ).toBe(true)
  })

  it('splices a PAGE field into a body paragraph', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_page_number', paragraphId: anchor.id, offset: 6 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    const field = xml.match(FIELD)?.[0]
    expect(field).toContain(' PAGE ')
    expect(xml.indexOf('Alice ')).toBeLessThan(
      xml.indexOf('fldCharType="begin"'),
    )
    expect(xml).toContain('Example overview')
  })

  it('carries a header text edit and a page number in one batch', async () => {
    const document = await parseFixture()
    const header = storyParagraphs(document, 'word/header2.xml')[0]
    const run = header?.runs[0]
    if (!header || !run) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Matter header' },
      { type: 'insert_page_number', paragraphId: header.id, offset: 13 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/header2.xml')

    expect(xml).toContain('Matter header')
    expect(xml.match(FIELD)?.[0]).toContain(' PAGE ')
    // The splice landed after the replaced text: the field sits at the end.
    expect(xml.indexOf('Matter header')).toBeLessThan(
      xml.indexOf('fldCharType="begin"'),
    )

    const reparsed = storyParagraphs(
      await parseDocx(output),
      'word/header2.xml',
    )[0]
    expect(reparsed?.runs.map((item) => item.text).join('')).toBe(
      'Matter header',
    )
  })

  it('writes a paragraph inserted into a footer part', async () => {
    const document = await parseFixture()
    const anchor = storyParagraphs(document, 'word/footer1.xml')[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: anchor.id,
        text: 'Second line',
      },
      {
        type: 'insert_page_number',
        paragraphId: anchor.id,
        offset: 0,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/footer1.xml')

    expect(xml).toContain('First footer')
    expect(xml).toContain('Second line')
    expect(xml.match(FIELD)?.[0]).toContain(' PAGE ')

    const reparsed = storyParagraphs(
      await parseDocx(output),
      'word/footer1.xml',
    )
    expect(
      reparsed.map((paragraph) =>
        paragraph.runs.flatMap((run) => run.text).join(''),
      ),
    ).toEqual(['First footer', 'Second line'])
  })

  it('refuses a notes or comments anchor', async () => {
    const document = await parseFixture()
    const footnote = document.model.stories.find(
      (story) => story.kind === 'footnotes',
    )?.paragraphs[0]
    if (!footnote) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_page_number', paragraphId: footnote.id, offset: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('refuses a paragraph already carrying tracked changes', async () => {
    const document = await parseFixture()
    const tracked = mainParagraphs(document).find(
      (paragraph) =>
        document.paragraphAnchors.get(paragraph.id)?.hasTrackedChanges,
    )
    if (!tracked) throw new Error('Tracked paragraph is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_page_number', paragraphId: tracked.id, offset: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('fails closed under tracked changes', async () => {
    const document = await parseFixture()
    const anchor = storyParagraphs(document, 'word/footer2.xml')[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(
        document,
        [{ type: 'insert_page_number', paragraphId: anchor.id, offset: 0 }],
        TRACKING,
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('preserves every other package part byte for byte', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const anchor = storyParagraphs(document, 'word/header2.xml')[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_page_number', paragraphId: anchor.id, offset: 4 },
    ])
    const output = await serialiseDocx(document)
    const before = await JSZip.loadAsync(input)
    const after = await JSZip.loadAsync(output)
    for (const name of [
      'word/document.xml',
      'word/styles.xml',
      'word/numbering.xml',
      'word/header1.xml',
      'word/footer1.xml',
      'word/footer2.xml',
      'word/media/image1.png',
    ]) {
      const original = before.file(name)
      const edited = after.file(name)
      if (!original || !edited) throw new Error(`Missing part ${name}.`)
      expect(await edited.async('uint8array')).toEqual(
        await original.async('uint8array'),
      )
    }
    // The edited header part itself carries only the field splice: the run is
    // split at offset 4 around the field.
    const xml = await zipText(output, 'word/header2.xml')
    expect(xml.match(FIELD)?.[0]).toContain(' PAGE ')
    expect(xml).toContain('<w:t>Jane</w:t>')
    expect(xml).toContain(' Example second header')
  })
})

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

function storyParagraphs(
  document: Awaited<ReturnType<typeof parseDocx>>,
  partName: string,
) {
  return (
    document.model.stories.find((story) => story.partName === partName)
      ?.paragraphs ?? []
  )
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}
