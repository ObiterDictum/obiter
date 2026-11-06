import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import {
  applyDocumentEdits,
  canonicaliseParagraphIdentities,
  missingFootnoteStyles,
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

  it('adds the Word footnote styles when the package lacks them, once', async () => {
    const document = await parseDocx(await fixtureWithoutFootnotes())
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 0,
        text: 'One',
      },
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 3,
        text: 'Two',
      },
    ])
    const output = await serialiseDocx(document)
    const styles = await zipText(output, 'word/styles.xml')

    expect(styles.match(/w:styleId="FootnoteText"/gu)).toHaveLength(1)
    expect(styles.match(/w:styleId="FootnoteReference"/gu)).toHaveLength(1)
    expect(styles).toMatch(
      /<w:style w:type="character" w:styleId="FootnoteReference">.*<w:vertAlign w:val="superscript"\/>.*<\/w:style>/u,
    )
    expect(styles).toMatch(
      /<w:style w:type="paragraph" w:styleId="FootnoteText">.*<w:sz w:val="20"\/>.*<\/w:style>/u,
    )
    expect(styles).toContain('w:styleId="Heading1"')
    const reparsed = await parseDocx(output)
    expect(reparsed.model.styles.map((style) => style.styleId)).toEqual(
      expect.arrayContaining(['FootnoteText', 'FootnoteReference']),
    )
  })

  it('writes the reference marks superscript even without a styles part', async () => {
    const zip = await JSZip.loadAsync(await fixtureWithoutFootnotes())
    zip.remove('word/styles.xml')
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string')
    const types = await zip.file('[Content_Types].xml')?.async('string')
    if (!rels || !types) throw new Error('Fixture part is missing.')
    zip.file(
      'word/_rels/document.xml.rels',
      rels.replace(/<Relationship[^>]*relationships\/styles"[^>]*\/>/u, ''),
    )
    zip.file(
      '[Content_Types].xml',
      types.replace(/<Override[^>]*styles\.xml[^>]*\/>/u, ''),
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
        text: 'One',
      },
    ])
    const output = await serialiseDocx(document)
    const superscript =
      '<w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr>'

    expect(await zipText(output, 'word/document.xml')).toContain(
      `${superscript}<w:footnoteReference w:id="1"/>`,
    )
    expect(await zipText(output, 'word/footnotes.xml')).toContain(
      `${superscript}<w:footnoteRef/>`,
    )
    expect((await JSZip.loadAsync(output)).file('word/styles.xml')).toBeNull()
  })

  it("keeps a document's own footnote styles untouched", async () => {
    const zip = await JSZip.loadAsync(await fixtureWithoutFootnotes())
    const own =
      '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>'
    const styles = await zip.file('word/styles.xml')?.async('string')
    if (!styles) throw new Error('Fixture part is missing.')
    zip.file(
      'word/styles.xml',
      styles.replace('</w:styles>', `${own}</w:styles>`),
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
        text: 'One',
      },
    ])
    const saved = await zipText(
      await serialiseDocx(document),
      'word/styles.xml',
    )

    expect(saved).toContain(own)
    expect(saved.match(/w:styleId="FootnoteText"/gu)).toHaveLength(1)
    expect(saved.match(/w:styleId="FootnoteReference"/gu)).toHaveLength(1)
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

    expect(body.match(/<w:footnoteReference w:id="1"\/>/gu)).toHaveLength(1)
    expect(body).toContain('<w:footnoteReference w:id="2"/>')
    expect(notes).toMatch(/<w:footnote\b[^>]*w:id="2">/u)
  })

  it('refuses an orphaned notes part that no document relationship names', async () => {
    const zip = await JSZip.loadAsync(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const rels = await zip.file('word/_rels/document.xml.rels')?.async('string')
    if (!rels) throw new Error('Fixture rels part is missing.')
    zip.file(
      'word/_rels/document.xml.rels',
      rels.replace(/<Relationship [^>]*Type="[^"]*\/footnotes"[^>]*\/>/u, ''),
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')

    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_footnote',
          paragraphId: anchor.id,
          offset: 0,
          text: 'New note',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-package' }))
  })

  it('escapes note text and keeps every other part byte for byte, styles only gaining the note styles', async () => {
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
    const changed = new Set([
      'word/document.xml',
      'word/footnotes.xml',
      'word/styles.xml',
    ])
    const stylesBefore = await before.file('word/styles.xml')?.async('string')
    const stylesAfter = await after.file('word/styles.xml')?.async('string')
    const added = missingFootnoteStyles(document.model.styles.slice(0, -2))
      .map((style) => style.sourceFragment)
      .join('')
    expect(added).not.toBe('')
    expect(stylesAfter).toBe(
      stylesBefore?.replace('</w:styles>', `${added}</w:styles>`),
    )
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

    expect(() =>
      applyDocumentEdits(document, [
        { type: 'delete_paragraph', paragraphId: note.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'last-paragraph-required' }))

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

describe('footnote deletion', () => {
  it('removes the reference run and its note entry, leaving the other note', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')
    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 6,
        text: 'Kept note',
      },
    ])
    const seeded = await parseDocx(await serialiseDocx(document))
    const reference = referenceRuns(seeded).find((run) =>
      run.preservedXmlFragments.join('').includes('w:id="2"'),
    )
    if (!reference) throw new Error('Inserted reference is missing.')
    const before = referenceRuns(seeded).length

    applyDocumentEdits(seeded, [
      { type: 'delete_footnote', runId: reference.id },
    ])
    const output = await serialiseDocx(seeded)
    const body = await zipText(output, 'word/document.xml')
    const notes = await zipText(output, 'word/footnotes.xml')

    expect(body).not.toContain('<w:footnoteReference w:id="2"/>')
    expect(notes).not.toMatch(/<w:footnote\b[^>]*w:id="2"/u)
    expect(notes).not.toContain('Kept note')
    expect(notes).toContain('w:id="-1"')
    const reparsed = await parseDocx(output)
    expect(referenceRuns(reparsed)).toHaveLength(before - 1)
    expect(
      mainParagraphs(reparsed)[0]
        ?.runs.map((run) => run.text)
        .join(''),
    ).toBe(
      mainParagraphs(seeded)[0]
        ?.runs.map((run) => run.text)
        .join(''),
    )
    const story = reparsed.model.stories.find(
      (item) => item.kind === 'footnotes',
    )
    expect(
      story?.paragraphs.some((paragraph) =>
        paragraph.runs.some((run) => run.text.includes('Kept note')),
      ),
    ).toBe(false)
  })

  it('deletes alongside a text edit in the same paragraph', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture paragraph is missing.')
    applyDocumentEdits(document, [
      {
        type: 'insert_footnote',
        paragraphId: anchor.id,
        offset: 6,
        text: 'Gone',
      },
    ])
    const seeded = await parseDocx(await serialiseDocx(document))
    const paragraph = mainParagraphs(seeded)[0]
    const reference = paragraph?.runs.find((run) =>
      run.preservedXmlFragments.join('').includes('<w:footnoteReference'),
    )
    const text = paragraph?.runs.find((run) => run.text.length > 0)
    if (!reference || !text) throw new Error('Inserted reference is missing.')

    applyDocumentEdits(seeded, [
      { type: 'replace_run_text', runId: text.id, text: 'Edited ' },
      { type: 'delete_footnote', runId: reference.id },
    ])
    const output = await serialiseDocx(seeded)
    const body = await zipText(output, 'word/document.xml')
    expect(body).toContain('Edited ')
    expect(body).not.toContain('<w:footnoteReference w:id="2"/>')
    expect(await zipText(output, 'word/footnotes.xml')).not.toContain('Gone')
  })

  it('refuses a reference that shares its run with other content', async () => {
    const document = await parseFixture()
    const shared = referenceRuns(document)[0]
    if (!shared) throw new Error('Fixture reference is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'delete_footnote', runId: shared.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('refuses a run that holds no footnote reference', async () => {
    const document = await parseFixture()
    const run = mainParagraphs(document)[0]?.runs.find(
      (item) => item.text.length > 0,
    )
    if (!run) throw new Error('Fixture run is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'delete_footnote', runId: run.id },
      ]),
    ).toThrow()
  })

  it('refuses while changes are tracked', async () => {
    const document = await parseFixture()
    const reference = referenceRuns(document)[0]
    if (!reference) throw new Error('Fixture reference is missing.')
    expect(() =>
      applyDocumentEdits(
        document,
        [{ type: 'delete_footnote', runId: reference.id }],
        TRACKING,
      ),
    ).toThrow()
  })
})

function referenceRuns(document: Awaited<ReturnType<typeof parseDocx>>) {
  return mainParagraphs(document).flatMap((paragraph) =>
    paragraph.runs.filter((run) =>
      run.preservedXmlFragments.join('').includes('<w:footnoteReference'),
    ),
  )
}

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

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
