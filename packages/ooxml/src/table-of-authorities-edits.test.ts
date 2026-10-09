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

describe('table-of-authorities edits', () => {
  it('splices the field, marks the citations and bookmarks the citing paragraph', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)

    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'The court applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // The generated field: instruction, heading, one entry carrying the
    // citation text and a PAGEREF to the citing paragraph's bookmark.
    expect(xml).toContain(' TOA ')
    expect(xml).toContain('Table of Cases')
    expect(xml).toContain('w:name="_ToA1"')
    expect(xml).toContain('PAGEREF _ToA1')
    // The hidden TA mark sits after the citation inside the citing run.
    expect(xml).toContain(' TA \\l "[2020] UKSC 1" \\s "[2020] UKSC 1" \\c 1 ')
    // The anchor split: head text, then the field result, then the tail
    // holding the rest of 'Jane Example referenceJane Example reference'.
    const head = xml.indexOf('Jane ')
    const entryOffset = xml.indexOf('[2020] UKSC 1</w:t>', head)
    const tailOffset = xml.indexOf('Example reference', entryOffset)
    expect(head).toBeGreaterThanOrEqual(0)
    expect(head).toBeLessThan(entryOffset)
    expect(entryOffset).toBeLessThan(tailOffset)

    // Reparse: the entry paragraph reads back with its stored text, the
    // citing paragraph carries the bookmark and the hidden mark runs, and
    // the tail holds the field's `end` ahead of the rest of the anchor.
    const reparsed = await parseDocx(output)
    const paragraphs = mainParagraphs(reparsed)
    const headIndex = paragraphs.findIndex(
      (paragraph) => paragraph.runs.map((run) => run.text).join('') === 'Jane ',
    )
    expect(headIndex).toBeGreaterThanOrEqual(0)
    const heading = paragraphs[headIndex + 1]
    expect(heading?.styleId).toBe('TOAHeading')
    expect(heading?.runs.map((run) => run.text).join('')).toBe('Table of Cases')
    expect(
      heading?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="begin"'),
        ),
      ),
    ).toBe(true)
    const entry = paragraphs[headIndex + 2]
    expect(entry?.styleId).toBe('TableofAuthorities')
    expect(entry?.runs.map((run) => run.text).join('')).toBe('[2020] UKSC 1')
    expect(
      entry?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('PAGEREF _ToA1'),
        ),
      ),
    ).toBe(true)
    const tail = paragraphs[headIndex + 3]
    expect(tail?.runs.map((run) => run.text).join('')).toBe(
      'Example referenceJane Example reference',
    )
    expect(
      tail?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="end"'),
        ),
      ),
    ).toBe(true)
    const citing = paragraphs.find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') ===
        'The court applied [2020] UKSC 1.',
    )
    expect(
      citing?.preservedXmlFragments.some((fragment) =>
        fragment.includes('w:name="_ToA1"'),
      ),
    ).toBe(true)
    expect(
      citing?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes(' TA \\l "[2020] UKSC 1"'),
        ),
      ),
    ).toBe(true)
  })

  it('lists two distinct citations in order and one entry per citing paragraph', async () => {
    const document = await parseFixture()
    const { cited, second, anchor } = toaFixture(document)

    applyDocumentEdits(document, [
      ...cite(
        document,
        cited.id,
        'Applied [2020] UKSC 1 and [2019] EWCA Civ 12.',
      ),
      ...cite(document, second.id, 'See [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 0,
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )

    // Two entries sorted by citation text: the shared citation collects
    // both citing paragraphs' bookmarks as two PAGEREF fields.
    expect(xml).toContain(' TA \\l "[2019] EWCA Civ 12"')
    expect(xml).toContain(' TA \\l "[2020] UKSC 1"')
    const reparsed = await parseDocx(await serialiseDocx(document))
    const entries = mainParagraphs(reparsed).filter(
      (paragraph) => paragraph.styleId === 'TableofAuthorities',
    )
    expect(
      entries.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['[2019] EWCA Civ 12', '[2020] UKSC 1, '])
    // The shared entry references both citing paragraphs' bookmarks —
    // the ', ' above is the separator between its two PAGEREF fields.
    expect(
      entries[1]?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('PAGEREF _ToA'),
        ),
      ),
    ).toBe(true)
    expect(
      mainParagraphs(reparsed).filter((paragraph) =>
        paragraph.preservedXmlFragments.some((fragment) =>
          fragment.includes('w:name="_ToA'),
        ),
      ),
    ).toHaveLength(2)
  })

  it('drops a citing paragraph the same batch deletes', async () => {
    const document = await parseFixture()
    const { cited, second, anchor } = toaFixture(document)

    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'See [2019] UKSC 3.'),
      ...cite(document, second.id, 'Applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 0,
      },
      { type: 'delete_paragraph', paragraphId: second.id },
    ])
    const reparsed = await parseDocx(await serialiseDocx(document))
    const entries = mainParagraphs(reparsed).filter(
      (paragraph) => paragraph.styleId === 'TableofAuthorities',
    )
    expect(
      entries.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['[2019] UKSC 3'])
  })

  it('does not mark or list a citation in a same-batch inserted paragraph', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)

    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'Applied [2020] UKSC 1.'),
      {
        type: 'insert_paragraph_after',
        paragraphId: cited.id,
        text: 'Pending [2021] UKSC 2',
      },
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 0,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // The pending paragraph's text saves, but no mark or entry binds it: a
    // paragraph with no stored anchor cannot hold a `_ToA` bookmark.
    expect(xml).not.toContain(' TA \\l "[2021] UKSC 2"')
    const reparsed = await parseDocx(output)
    const entries = mainParagraphs(reparsed).filter(
      (paragraph) => paragraph.styleId === 'TableofAuthorities',
    )
    expect(
      entries.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(['[2020] UKSC 1'])
  })

  it('skips a citation inside a generated field-result paragraph', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)

    // A `TableofAuthorities`-styled paragraph holds captured output, not a
    // citing instance: with it the only citation, the field refuses empty.
    expect(() =>
      applyDocumentEdits(document, [
        ...cite(document, cited.id, 'Restated [2020] UKSC 1.'),
        {
          type: 'set_paragraph_style',
          paragraphId: cited.id,
          styleId: 'TableofAuthorities',
        },
        {
          type: 'insert_table_of_authorities',
          paragraphId: anchor.id,
          offset: 0,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a document with no citations', async () => {
    const document = await parseDocx(await createBlankDocx())
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_table_of_authorities',
          paragraphId: anchor.id,
          offset: 0,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a field when the batch deletes the only citing paragraph', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)

    expect(() =>
      applyDocumentEdits(document, [
        ...cite(document, cited.id, 'Applied [2020] UKSC 1.'),
        {
          type: 'insert_table_of_authorities',
          paragraphId: anchor.id,
          offset: 0,
        },
        { type: 'delete_paragraph', paragraphId: cited.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses an anchor inside a table cell or content control', async () => {
    const document = await parseFixture()
    toaFixture(document)
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
        {
          type: 'insert_table_of_authorities',
          paragraphId: nested.id,
          offset: 0,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a paragraph whose properties end a section', async () => {
    const document = await parseFixture()
    const { cited } = toaFixture(document)
    const section = mainParagraphs(document).find(
      (paragraph) =>
        paragraph.runs.map((run) => run.text).join('') === 'Restarted list',
    )
    if (!section) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        ...cite(document, cited.id, 'Applied [2020] UKSC 1.'),
        {
          type: 'insert_table_of_authorities',
          paragraphId: section.id,
          offset: 0,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a story that cannot hold the field', async () => {
    const document = await parseFixture()
    const { cited } = toaFixture(document)
    const header = storyParagraphs(document, 'word/header2.xml')[0]
    if (!header) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        ...cite(document, cited.id, 'Applied [2020] UKSC 1.'),
        {
          type: 'insert_table_of_authorities',
          paragraphId: header.id,
          offset: 0,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('refuses an anchor already carrying tracked changes', async () => {
    const document = await parseFixture()
    const { cited } = toaFixture(document)
    const tracked = mainParagraphs(document).find(
      (paragraph) =>
        document.paragraphAnchors.get(paragraph.id)?.hasTrackedChanges,
    )
    if (!tracked) throw new Error('Tracked paragraph is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        ...cite(document, cited.id, 'Applied [2020] UKSC 1.'),
        {
          type: 'insert_table_of_authorities',
          paragraphId: tracked.id,
          offset: 0,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('fails closed under tracked changes', async () => {
    const document = await parseFixture()
    const { cited, anchor } = toaFixture(document)
    expect(() =>
      applyDocumentEdits(
        document,
        [
          ...cite(document, cited.id, 'Applied [2020] UKSC 1.'),
          {
            type: 'insert_table_of_authorities',
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
    const { cited, anchor } = toaFixture(document)

    applyDocumentEdits(document, [
      ...cite(document, cited.id, 'Applied [2020] UKSC 1.'),
      {
        type: 'insert_table_of_authorities',
        paragraphId: anchor.id,
        offset: 5,
      },
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

function toaFixture(document: Awaited<ReturnType<typeof parseDocx>>) {
  const paragraphs = mainParagraphs(document)
  const byText = (text: string) =>
    paragraphs.find(
      (paragraph) => paragraph.runs.map((run) => run.text).join('') === text,
    )
  const cited = byText('Commented text')
  const second = byText('Alice Example overview')
  const anchor = byText('Jane Example referenceJane Example reference')
  if (!cited || !second || !anchor) {
    throw new Error('Fixture model is missing.')
  }
  return { cited, second, anchor }
}

/**
 * The op rewriting the paragraph's first run so the batch reads the citation
 * text — the effective-text update the writer's collector reads, without a
 * fixture carrying real citation prose. Returned as operations rather than
 * applied: each `applyDocumentEdits` is one save batch, and composing a
 * pending replacement twice serialises differently than one batch does.
 */
function cite(
  document: Awaited<ReturnType<typeof parseDocx>>,
  paragraphId: string,
  text: string,
) {
  const paragraph = mainParagraphs(document).find(
    (item) => item.id === paragraphId,
  )
  const run = paragraph?.runs.find((item) => item.text.length > 0)
  if (!run) throw new Error('Fixture run is missing.')
  return [{ type: 'replace_run_text' as const, runId: run.id, text }]
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
