import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import {
  applyDocumentEdits,
  createBlankDocx,
  parseDocx,
  serialiseDocx,
} from './index'

const TRACKING = { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' }

describe('table-of-contents edits', () => {
  it('splices a multi-paragraph TOC field inside a run', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Jane Example referenceJane Example reference',
    )
    if (!anchor) throw new Error('Fixture model is missing.')

    // Offset 5 lands strictly inside the single run's text — the position a
    // paragraph split must reparent, not an end-of-paragraph boundary.
    applyDocumentEdits(document, [
      { type: 'insert_table_of_contents', paragraphId: anchor.id, offset: 5 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // The field instruction opens inside the first result paragraph.
    expect(xml).toContain(' TOC \\o "1-3" \\u ')
    // The heading was bookmarked and the entry references it.
    expect(xml).toContain('<w:bookmarkStart')
    expect(xml).toContain('w:name="_Toc1"')
    expect(xml).toContain('PAGEREF _Toc1')
    // The heading's text is the stored entry text.
    expect(xml).toContain('Alice Example overview')
    // The anchor split: head text, then the field result, then the tail
    // holding the rest of 'Jane Example referenceJane Example reference'.
    // The entry text is the occurrence after the anchor's head — the first
    // is the heading paragraph itself.
    const head = xml.indexOf('Jane ')
    const firstEntry = xml.indexOf('Alice Example overview', head)
    const tail = xml.indexOf('Example reference', firstEntry)
    expect(head).toBeGreaterThanOrEqual(0)
    expect(head).toBeLessThan(firstEntry)
    expect(firstEntry).toBeLessThan(tail)

    // Reparse: the entry paragraphs read back with their stored text and
    // the anchor's runs still join to the full original text.
    const reparsed = await parseDocx(output)
    const paragraphs = mainParagraphs(reparsed)
    const anchorIndex = paragraphs.findIndex(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') === 'Jane ',
    )
    expect(anchorIndex).toBeGreaterThanOrEqual(0)
    const entry = paragraphs[anchorIndex + 1]
    expect(entry?.runs.map((run) => run.text).join('')).toBe(
      'Alice Example overview',
    )
    expect(
      entry?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('PAGEREF _Toc1'),
        ),
      ),
    ).toBe(true)
    expect(
      entry?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="begin"'),
        ),
      ),
    ).toBe(true)
    const tailParagraph = paragraphs[anchorIndex + 2]
    expect(tailParagraph?.runs.map((run) => run.text).join('')).toBe(
      'Example referenceJane Example reference',
    )
    expect(
      tailParagraph?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="end"'),
        ),
      ),
    ).toBe(true)
    // The heading carries the bookmark the entry references.
    const heading = paragraphs.find((paragraph) =>
      paragraph.preservedXmlFragments.some((fragment) =>
        fragment.includes('w:name="_Toc1"'),
      ),
    )
    expect(heading?.runs.map((run) => run.text).join('')).toBe(
      'Alice Example overview',
    )
  })

  it('splits a run whose text was replaced earlier in the batch', async () => {
    const document = await parseFixture()
    const { xrefAnchor } = tocFixture(document)
    const run = xrefAnchor.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: run.id,
        text: 'Typed replacement text',
      },
      {
        type: 'insert_table_of_contents',
        paragraphId: xrefAnchor.id,
        offset: 5,
      },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const paragraphs = mainParagraphs(reparsed)

    // The field split the effective text: 'Typed' closes the head, the
    // entry paragraph follows, and the tail opens with the rest of the
    // typed run ahead of the paragraph's untouched second run. The typed
    // text keeps the order the caret implied rather than moving wholesale
    // behind the field.
    const head = paragraphs.findIndex(
      (paragraph) =>
        paragraph.runs.map((item) => item.text).join('') === 'Typed',
    )
    expect(head).toBeGreaterThanOrEqual(0)
    expect(
      paragraphs[head + 1]?.runs.map((item) => item.text).join(''),
    ).toBe('Alice Example overview')
    expect(
      paragraphs[head + 2]?.runs.map((item) => item.text).join(''),
    ).toBe(' replacement textJane Example reference')
  })

  it('captures only stored headings, not a same-batch inserted one', async () => {
    const document = await parseFixture()
    const { xrefAnchor, tocAnchor } = tocFixture(document)

    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: xrefAnchor.id,
        text: 'Pending heading',
        styleId: 'Heading1',
      },
      {
        type: 'insert_table_of_contents',
        paragraphId: tocAnchor.id,
        offset: 0,
      },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const paragraphs = mainParagraphs(reparsed)

    const entries = paragraphs.filter(
      (paragraph) => paragraph.styleId === 'TOC1',
    )
    expect(entries.map((item) => item.runs.map((run) => run.text).join('')))
      .toEqual(['Alice Example overview'])
  })

  it('captures entries at outline level, not by display text', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') === 'Jane Example referenceJane Example reference',
    )
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table_of_contents', paragraphId: anchor.id, offset: 0 },
    ])
    const output = await serialiseDocx(document)
    const reparsed = await parseDocx(output)
    const paragraphs = mainParagraphs(reparsed)

    // Only the Heading1-styled paragraph is captured; the fixture's
    // 'Restarted list' and plain paragraphs are not, and the heading style
    // carries no explicit w:outlineLvl — the built-in style id decides.
    const entries = paragraphs.filter(
      (paragraph) => paragraph.styleId === 'TOC1',
    )
    expect(entries.map((item) => item.runs.map((run) => run.text).join('')))
      .toEqual(['Alice Example overview'])
  })

  it('reuses an existing _Toc bookmark for a second field', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const first = paragraphs.find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Jane Example referenceJane Example reference',
    )
    const second = paragraphs.find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') === 'Commented text',
    )
    if (!first || !second) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table_of_contents', paragraphId: first.id, offset: 0 },
      { type: 'insert_table_of_contents', paragraphId: second.id, offset: 0 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // Both fields reference the heading's single bookmark; the paragraph
    // carries one pair, not a nested duplicate.
    expect(xml.match(/PAGEREF _Toc1 /gu)?.length).toBe(2)
    expect(xml.match(/w:name="_Toc1"/gu)?.length).toBe(1)
  })

  it('keeps a cross-reference bookmark and a _Toc bookmark on one heading', async () => {
    const document = await parseFixture()
    const { heading, xrefAnchor, tocAnchor } = tocFixture(document)

    applyDocumentEdits(document, [
      {
        type: 'insert_cross_reference',
        paragraphId: xrefAnchor.id,
        offset: 0,
        targetParagraphId: heading.id,
      },
      {
        type: 'insert_table_of_contents',
        paragraphId: tocAnchor.id,
        offset: 0,
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )

    // The heading carries both families' pairs: the _Ref write must not
    // clobber the _Toc one the PAGEREF names.
    expect(xml).toContain('w:name="_Ref_1"')
    expect(xml).toContain('w:name="_Toc1"')
    expect(xml).toContain(' REF _Ref_1 ')
    expect(xml).toContain('PAGEREF _Toc1')
  })

  it('keeps both bookmark families when the field is written first', async () => {
    const document = await parseFixture()
    const { heading, xrefAnchor, tocAnchor } = tocFixture(document)

    applyDocumentEdits(document, [
      {
        type: 'insert_table_of_contents',
        paragraphId: tocAnchor.id,
        offset: 0,
      },
      {
        type: 'insert_cross_reference',
        paragraphId: xrefAnchor.id,
        offset: 0,
        targetParagraphId: heading.id,
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )

    expect(xml).toContain('w:name="_Ref_1"')
    expect(xml).toContain('w:name="_Toc1"')
    expect(xml).toContain(' REF _Ref_1 ')
    expect(xml).toContain('PAGEREF _Toc1')
  })

  it('refuses a body anchor inside a table cell or content control', async () => {
    const document = await parseFixture()
    const nested = mainParagraphs(document).find((paragraph) => {
      const anchor = document.paragraphAnchors.get(paragraph.id)
      return (
        paragraph.runs.map((run) => run.text).join('') ===
          'Controlled content' && anchor !== undefined
      )
    })
    // The content-control paragraph may not be anchorable at all — either a
    // missing anchor or a refusal is the fail-closed answer.
    if (!nested) {
      expect(
        mainParagraphs(document).some(
          (paragraph) =>
            paragraph.runs.map((run) => run.text).join('') ===
            'Controlled content',
        ),
      ).toBe(false)
      return
    }
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_table_of_contents', paragraphId: nested.id, offset: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a paragraph whose properties end a section', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') === 'Restarted list',
    )
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_table_of_contents', paragraphId: anchor.id, offset: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a story that cannot hold paragraph siblings', async () => {
    const document = await parseFixture()
    const header = storyParagraphs(document, 'word/header2.xml')[0]
    if (!header) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_table_of_contents', paragraphId: header.id, offset: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('refuses a document with no headings', async () => {
    const document = await parseDocx(await createBlankDocx())
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_table_of_contents', paragraphId: anchor.id, offset: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
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
        { type: 'insert_table_of_contents', paragraphId: tracked.id, offset: 0 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('fails closed under tracked changes', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Jane Example referenceJane Example reference',
    )
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(
        document,
        [
          {
            type: 'insert_table_of_contents',
            paragraphId: anchor.id,
            offset: 0,
          },
        ],
        TRACKING,
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('preserves every other package part byte for byte', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const anchor = mainParagraphs(document).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'Jane Example referenceJane Example reference',
    )
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table_of_contents', paragraphId: anchor.id, offset: 5 },
    ])
    const output = await serialiseDocx(document)
    const before = await JSZip.loadAsync(input)
    const after = await JSZip.loadAsync(output)
    for (const name of [
      'word/styles.xml',
      'word/numbering.xml',
      'word/header1.xml',
      'word/header2.xml',
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
  })
})

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

function tocFixture(document: Awaited<ReturnType<typeof parseDocx>>) {
  const paragraphs = mainParagraphs(document)
  const byText = (text: string) =>
    paragraphs.find(
      (paragraph) => paragraph.runs.map((run) => run.text).join('') === text,
    )
  const heading = byText('Alice Example overview')
  const xrefAnchor = byText('Jane Example referenceJane Example reference')
  const tocAnchor = byText('Commented text')
  if (!heading || !xrefAnchor || !tocAnchor) {
    throw new Error('Fixture model is missing.')
  }
  return { heading, xrefAnchor, tocAnchor }
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
