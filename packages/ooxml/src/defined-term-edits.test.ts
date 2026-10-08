import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

describe('mark_defined_term edits', () => {
  it('splices a _Def_ bookmark pair around the covered words, inserting no text', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Alice Example overview'),
    )
    if (!anchor) throw new Error('Anchor paragraph is missing.')

    // [0, 13) covers 'Alice Example' — the defined term.
    applyDocumentEdits(document, [
      {
        type: 'mark_defined_term',
        paragraphId: anchor.id,
        from: 0,
        to: 13,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // Scope to the anchor's stored w14 paraId.
    const paragraphXml = xml.slice(
      xml.indexOf('A1B2C3D4'),
      xml.indexOf('</w:p>', xml.indexOf('A1B2C3D4')),
    )
    // The bookmark id must clear the fixture's stored w:id="4".
    const start =
      /<w:bookmarkStart w:id="(\d+)" w:name="_Def_alice_example"\/>/u.exec(
        paragraphXml,
      )
    expect(start).not.toBeNull()
    expect(Number(start?.[1])).toBeGreaterThan(4)
    expect(paragraphXml).toContain(
      `<w:bookmarkEnd w:id="${start?.[1] ?? ''}"/>`,
    )
    // The pair wraps the term: start before, end after, text untouched.
    const ordered =
      /<w:bookmarkStart[^>]*_Def_alice_example[^>]*\/>[\s\S]*Alice Example[\s\S]*<w:bookmarkEnd[^>]*\/>/u
    expect(paragraphXml).toMatch(ordered)
    // The covered run splits at the mark's edge; the text joins unchanged.
    expect(paragraphXml).toContain('Alice Example')
    expect(paragraphXml).toContain(' overview')

    const reparsed = mainParagraphs(await parseDocx(output))
    const paragraph = reparsed.find((item) => item.id === anchor.id)
    expect(paragraph?.runs.map((run) => run.text).join('')).toBe(
      'Alice Example overview',
    )
    expect(
      paragraph?.preservedXmlFragments.some((fragment) =>
        fragment.includes('_Def_alice_example'),
      ),
    ).toBe(true)
  })

  it('marks a mid-run range without disturbing the surrounding runs', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Alice Example overview'),
    )
    if (!anchor) throw new Error('Anchor paragraph is missing.')

    // [6, 13) covers 'Example'.
    applyDocumentEdits(document, [
      {
        type: 'mark_defined_term',
        paragraphId: anchor.id,
        from: 6,
        to: 13,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('w:name="_Def_example"')
    expect(xml).toContain('Alice ')
    expect(xml).toContain(' overview')
  })

  it('refuses a range that cannot name a term', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Alice Example overview'),
    )
    if (!anchor) throw new Error('Anchor paragraph is missing.')
    // [5, 6) is the space between 'Alice' and 'Example' — no word characters.
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'mark_defined_term',
          paragraphId: anchor.id,
          from: 5,
          to: 6,
        },
      ]),
    ).toThrowError()
    const output = await serialiseDocx(document)
    expect(await zipText(output, 'word/document.xml')).not.toContain('_Def_')
  })

  it('refuses a tracked-changes paragraph and a non-body story', async () => {
    const document = await parseFixture()
    const tracked = [...document.paragraphAnchors.values()].find(
      (anchor) =>
        anchor.hasTrackedChanges && anchor.partName === 'word/document.xml',
    )
    if (!tracked) throw new Error('Tracked paragraph is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'mark_defined_term',
          paragraphId: tracked.wire.id,
          from: 0,
          to: 4,
        },
      ]),
    ).toThrowError()

    const note = document.model.stories
      .find((story) => story.kind === 'footnotes')
      ?.paragraphs.find((paragraph) => paragraph.runs.length > 0)
    if (!note) throw new Error('Footnote paragraph is missing.')
    const noteEnd = note.runs.map((run) => run.text).join('').length
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'mark_defined_term',
          paragraphId: note.id,
          from: 0,
          to: noteEnd,
        },
      ]),
    ).toThrowError()
  })
})

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}
