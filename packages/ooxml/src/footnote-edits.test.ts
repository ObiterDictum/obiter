import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import {
  applyDocumentEdits,
  canonicaliseParagraphIdentities,
  parseDocx,
  serialiseDocx,
} from './index'

const TRACKING = { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' }
const FOOTNOTE_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes'
const FOOTNOTE_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml'

describe('footnote edits', () => {
  it('splices a reference run at the caret and appends the note entry', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 6,
        text: 'Example footnote text',
      },
    ])
    const output = await serialiseDocx(document)
    const body = await zipText(output, 'word/document.xml')
    const notes = await zipText(output, 'word/footnotes.xml')

    // The existing entry holds w:id 1, so the new note allocates 2.
    expect(body).toContain('<w:footnoteReference w:id="2"/>')
    expect(body).toContain('<w:rStyle w:val="FootnoteReference"/>')
    expect(body.indexOf('Alice ')).toBeLessThan(
      body.indexOf('footnoteReference'),
    )
    expect(notes).toContain('<w:footnote xmlns:w14=')
    expect(notes).toMatch(/<w:footnote\b[^>]*w:id="2">/u)
    expect(notes).toContain('<w:pStyle w:val="FootnoteText"/>')
    expect(notes).toContain('<w:footnoteRef/>')
    expect(notes).toContain('<w:t>Example footnote text</w:t>')

    // The reference run is zero-width: the reparse reads the same effective
    // text, and the note body lands in the footnotes story.
    const reparsed = await parseDocx(output)
    const paragraph = mainParagraphs(reparsed)[0]
    expect(paragraph?.runs.map((run) => run.text).join('')).toBe(
      'Alice Example overview',
    )
    expect(
      paragraph?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('footnoteReference'),
        ),
      ),
    ).toBe(true)
    const noteStory = reparsed.model.stories.find(
      (story) => story.kind === 'footnotes',
    )
    const noteParagraph = noteStory?.paragraphs.find((item) =>
      item.runs.some((run) => run.text === 'Example footnote text'),
    )
    expect(noteParagraph?.styleId).toBe('FootnoteText')
  })

  it('creates the part, separators, relationship and override when absent', async () => {
    const document = await parseDocx(await fixtureWithoutFootnotes())
    expect(
      document.model.stories.some((story) => story.kind === 'footnotes'),
    ).toBe(false)
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 0,
        text: 'First note',
      },
    ])
    const output = await serialiseDocx(document)
    const zip = await JSZip.loadAsync(output)

    const notes = await zip.file('word/footnotes.xml')?.async('string')
    expect(notes).toContain('<w:footnote w:type="separator" w:id="-1">')
    expect(notes).toContain(
      '<w:footnote w:type="continuationSeparator" w:id="0">',
    )
    expect(notes).toContain('<w:footnote w:id="1">')
    expect(notes).toContain('<w:t>First note</w:t>')

    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string')
    expect(rels).toContain(`Type="${FOOTNOTE_REL}"`)
    expect(rels).toContain('Target="footnotes.xml"')

    const types = await zip.file('[Content_Types].xml')?.async('string')
    expect(types).toContain(
      `PartName="/word/footnotes.xml" ContentType="${FOOTNOTE_CONTENT_TYPE}"`,
    )

    // The package must reparse: the new story is a real story, not a loose
    // part, and the reference resolves to the new entry.
    const reparsed = await parseDocx(output)
    const story = reparsed.model.stories.find(
      (item) => item.kind === 'footnotes',
    )
    expect(story?.partName).toBe('word/footnotes.xml')
    expect(
      story?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text === 'First note'),
      ),
    ).toBe(true)
  })

  it('allocates ids that never collide with existing or same-batch notes', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 1,
        text: 'Second note',
      },
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 3,
        text: 'Third note',
      },
    ])
    const notes = await zipText(
      await serialiseDocx(document),
      'word/footnotes.xml',
    )

    const ids = [...notes.matchAll(/<w:footnote\b[^>]*\bw:id="(-?\d+)"/gu)].map(
      (match) => match[1],
    )
    expect(ids).toContain('2')
    expect(ids).toContain('3')
    expect(new Set(ids).size).toBe(ids.length)
    expect(notes).toContain('<w:t>Second note</w:t>')
    expect(notes).toContain('<w:t>Third note</w:t>')
  })

  it('allocates above an orphaned reference whose entry was removed', async () => {
    // A stored w:footnoteReference can outlive its w:footnote entry; the
    // next note must allocate above the id the orphaned mark still names,
    // or the stored mark silently re-points at the new note.
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const stored = await zip.file('word/footnotes.xml')?.async('string')
    if (!stored) throw new Error('Fixture part is missing.')
    zip.file(
      'word/footnotes.xml',
      stored.replace(/<w:footnote w:id="1">.*?<\/w:footnote>/u, ''),
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 0,
        text: 'New note',
      },
    ])
    const output = await serialiseDocx(document)
    const body = await zipText(output, 'word/document.xml')
    const notes = await zipText(output, 'word/footnotes.xml')

    // The orphaned mark keeps id 1; the new note allocates 2, not 1.
    expect(body.match(/<w:footnoteReference w:id="1"\/>/gu)).toHaveLength(1)
    expect(body).toContain('<w:footnoteReference w:id="2"/>')
    expect(notes).toMatch(/<w:footnote\b[^>]*w:id="2">/u)
  })

  it('escapes note text and keeps every other part byte for byte', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 0,
        text: 'Marks <&> stay "quoted"',
      },
    ])
    const output = await serialiseDocx(document)
    const notes = await zipText(output, 'word/footnotes.xml')
    expect(notes).toContain('Marks &lt;&amp;&gt; stay "quoted"')

    const before = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const after = await JSZip.loadAsync(output)
    const changed = new Set(['word/document.xml', 'word/footnotes.xml'])
    for (const name of Object.keys(before.files)) {
      if (changed.has(name)) continue
      expect(await after.file(name)?.async('uint8array')).toEqual(
        await before.file(name)?.async('uint8array'),
      )
    }
  })

  it('survives the canonical identity pass on an existing notes part', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 0,
        text: 'Canonical note',
      },
    ])
    // The version-save path canonicalises every editable story's paragraph
    // identities after the edits run; the notes part must take the namespace
    // and the injected ids without corrupting the new entry.
    canonicaliseParagraphIdentities(document)
    const output = await serialiseDocx(document)
    const notes = await zipText(output, 'word/footnotes.xml')
    expect(notes).toContain('xmlns:w14=')
    const reparsed = await parseDocx(output)
    const story = reparsed.model.stories.find(
      (item) => item.kind === 'footnotes',
    )
    for (const paragraph of story?.paragraphs ?? []) {
      expect(paragraph.id).toMatch(/^para-w14-[0-9A-F]{8}$/u)
    }
  })

  it('refuses tracked-change mode and a tracked paragraph', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')
    expect(() =>
      applyDocumentEdits(
        document,
        [
          {
            type: 'insert_footnote',
            paragraphId: anchor.id,
            offset: 0,
            text: 'Tracked note',
          },
        ],
        TRACKING,
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))

    const tracked = mainParagraphs(document).find(
      (paragraph) =>
        document.paragraphAnchors.get(paragraph.id)?.hasTrackedChanges,
    )
    if (!tracked) throw new Error('Tracked paragraph is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_footnote',
          paragraphId: tracked.id,
          offset: 0,
          text: 'Tracked note',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('refuses an anchor outside the body story', async () => {
    const document = await parseFixture()
    const header = storyParagraphs(document, 'word/header1.xml')[0]
    const note = document.model.stories.find(
      (story) => story.kind === 'footnotes',
    )?.paragraphs[0]
    if (!header || !note) throw new Error('Fixture model is missing.')

    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_footnote',
          paragraphId: header.id,
          offset: 0,
          text: 'Margin note',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_footnote',
          paragraphId: note.id,
          offset: 0,
          text: 'Nested note',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('keeps every note entry one paragraph: the last w:p cannot leave', async () => {
    const document = await parseFixture()
    const note = document.model.stories
      .find((story) => story.kind === 'footnotes')
      ?.paragraphs.find((paragraph) => paragraph.runs.length > 0)
    if (!note) throw new Error('Fixture model is missing.')

    // The fixture's note entry holds a single paragraph, so deleting it
    // would leave the w:footnote element empty even though siblings survive.
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'delete_paragraph', paragraphId: note.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'last-paragraph-required' }))

    // A second paragraph inside the entry releases the delete: the entry
    // still holds a paragraph afterwards.
    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: note.id,
        text: 'Added line',
      },
      { type: 'delete_paragraph', paragraphId: note.id },
    ])
    const notes = await zipText(
      await serialiseDocx(document),
      'word/footnotes.xml',
    )
    expect(notes).toContain('<w:t>Added line</w:t>')
    expect(notes).not.toContain('Alice Example footnote')
  })

  it('edits a stored note paragraph like any editable story run', async () => {
    const document = await parseFixture()
    const noteRun = document.model.stories
      .find((story) => story.kind === 'footnotes')
      ?.paragraphs.flatMap((paragraph) => paragraph.runs)
      .find((run) => run.text.length > 0)
    if (!noteRun) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: noteRun.id, text: 'Rewritten note' },
    ])
    const notes = await zipText(
      await serialiseDocx(document),
      'word/footnotes.xml',
    )
    expect(notes).toContain('Rewritten note')
    expect(notes).not.toContain('Alice Example footnote')
  })
})

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

/**
 * The fixture package with the footnotes part, its content-type override,
 * its document relationship and the body mark that named an entry stripped —
 * the state a first footnote must repair. The `w:footnoteReference` has to
 * go with the part: a mark without an entry still reserves its `w:id`, so
 * leaving it would make the allocator skip id 1. Rewriting the declaring
 * parts keeps every other byte as the builder produced it.
 */
async function fixtureWithoutFootnotes() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.remove('word/footnotes.xml')
  zip.remove('word/_rels/footnotes.xml.rels')
  const rels = await zip.file('word/_rels/document.xml.rels')?.async('string')
  const types = await zip.file('[Content_Types].xml')?.async('string')
  const body = await zip.file('word/document.xml')?.async('string')
  if (!rels || !types || !body) throw new Error('Fixture part is missing.')
  zip.file(
    'word/document.xml',
    body.replace('<w:footnoteReference w:id="1"/>', ''),
  )
  zip.file(
    'word/_rels/document.xml.rels',
    rels.replace(/<Relationship[^>]*relationships\/footnotes[^>]*\/>/u, ''),
  )
  zip.file(
    '[Content_Types].xml',
    types.replace(/<Override[^>]*footnotes\.xml[^>]*\/>/u, ''),
  )
  return zip.generateAsync({ type: 'uint8array' })
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
