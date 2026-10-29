import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  contentTypesXml,
  documentRelationshipsXml,
  documentXml,
  numberingXml,
  rootRelationshipsXml,
  stylesXml,
} from '../fixtures/fixture-parts'

import {
  applyDocumentEdits,
  buildVersionLineage,
  canonicaliseParagraphIdentities,
  createLineageRecorder,
  parseDocx,
  serialiseDocx,
} from './index'
import { load, paragraphs } from './model-run-emphasis.test-support'

describe('mark_defined_term edits', () => {
  it('splices a _Def_ bookmark pair around the covered words, inserting no text', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'Alice Example overview'),
    )
    if (!anchor) throw new Error('Anchor paragraph is missing.')

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

    const paragraphXml = xml.slice(
      xml.indexOf('A1B2C3D4'),
      xml.indexOf('</w:p>', xml.indexOf('A1B2C3D4')),
    )
    const start =
      /<w:bookmarkStart w:id="(\d+)" w:name="_Def_alice_example"\/>/u.exec(
        paragraphXml,
      )
    expect(start).not.toBeNull()
    expect(Number(start?.[1])).toBeGreaterThan(4)
    expect(paragraphXml).toContain(
      `<w:bookmarkEnd w:id="${start?.[1] ?? ''}"/>`,
    )
    const ordered =
      /<w:bookmarkStart[^>]*_Def_alice_example[^>]*\/>[\s\S]*Alice Example[\s\S]*<w:bookmarkEnd[^>]*\/>/u
    expect(paragraphXml).toMatch(ordered)
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

  it('refuses a mark boundary that splits a surrogate pair', async () => {
    const document = await parseSurrogateFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('Term')),
    )
    if (!anchor) throw new Error('Surrogate paragraph is missing.')

    for (const range of [
      { from: 0, to: 6 },
      { from: 6, to: 11 },
    ]) {
      expect(() =>
        applyDocumentEdits(document, [
          {
            type: 'mark_defined_term',
            paragraphId: anchor.id,
            ...range,
          },
        ]),
      ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    }
    applyDocumentEdits(document, [
      { type: 'mark_defined_term', paragraphId: anchor.id, from: 8, to: 11 },
    ])
    const output = await serialiseDocx(document)
    expect(await zipText(output, 'word/document.xml')).toContain(
      'w:name="_Def_end"',
    )
  })

  it('refuses a mark boundary inside a stored hyperlink but composes around one', async () => {
    const document = await parseLinkedFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text === 'the report'),
    )
    if (!anchor) throw new Error('Linked paragraph is missing.')

    for (const range of [
      { from: 4, to: 8 },
      { from: 0, to: 5 },
      { from: 13, to: 20 },
    ]) {
      expect(() =>
        applyDocumentEdits(document, [
          {
            type: 'mark_defined_term',
            paragraphId: anchor.id,
            ...range,
          },
        ]),
      ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    }
    applyDocumentEdits(document, [
      { type: 'mark_defined_term', paragraphId: anchor.id, from: 0, to: 20 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('w:name="_Def_see_the_report_today"')
    expect(xml).toContain('<w:hyperlink')
  })

  it('writes a second mark of the same term under a distinct bookmark id', async () => {
    const document = await load(
      '<w:p><w:r><w:t>Term Alpha</w:t></w:r></w:p><w:p><w:r><w:t>Term Beta</w:t></w:r></w:p>',
    )
    const [first, second] = paragraphs(document)
    if (!first || !second) throw new Error('paragraphs')

    applyDocumentEdits(document, [
      { type: 'mark_defined_term', paragraphId: first.id, from: 0, to: 4 },
      { type: 'mark_defined_term', paragraphId: second.id, from: 0, to: 4 },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    const starts = [
      ...xml.matchAll(/<w:bookmarkStart w:id="(\d+)" w:name="_Def_term"\/>/gu),
    ]
    expect(starts).toHaveLength(2)
    const ids = starts.map((match) => match[1])
    expect(new Set(ids).size).toBe(2)
    for (const id of ids) {
      expect(xml).toContain(`<w:bookmarkEnd w:id="${id ?? ''}"/>`)
    }
  })

  it('records each split run piece in the version lineage', async () => {
    const document = await load(
      '<w:p><w:r><w:t>Alice Example overview</w:t></w:r></w:p>',
    )
    const recorder = createLineageRecorder(document.model)
    const paragraph = paragraphs(document)[0]
    const baseRun = paragraph?.runs[0]
    if (!paragraph || !baseRun) throw new Error('paragraph')
    applyDocumentEdits(
      document,
      [
        {
          type: 'mark_defined_term',
          paragraphId: paragraph.id,
          from: 6,
          to: 13,
        },
      ],
      undefined,
      recorder,
    )
    canonicaliseParagraphIdentities(document)
    const lineage = buildVersionLineage({
      recorder,
      model: document.model,
      canonicalParagraphIds: new Map(),
      baseVersionId: 'ver_1',
      versionId: 'ver_2',
    })
    const slices = (lineage.paragraphs[0]?.runs ?? []).map((run) =>
      run.segments.map((segment) => [
        segment.fromRunId,
        segment.fromOffset,
        segment.toOffset,
      ]),
    )
    expect(slices).toEqual([
      [[baseRun.id, 0, 6]],
      [[baseRun.id, 6, 13]],
      [[baseRun.id, 13, 22]],
    ])
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

function surrogateFixtureBytes() {
  const zip = new JSZip()
  const fixed = documentXml.replace(
    '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
    '<w:p w14:paraId="C1C2C3D4"><w:r><w:t>Term \u{1F600} end</w:t></w:r></w:p>' +
      '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
  )
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', rootRelationshipsXml)
  zip.file('word/document.xml', fixed)
  zip.file('word/_rels/document.xml.rels', documentRelationshipsXml)
  zip.file('word/styles.xml', stylesXml)
  zip.file('word/numbering.xml', numberingXml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function parseSurrogateFixture() {
  return parseDocx(await surrogateFixtureBytes())
}

function linkedFixtureBytes() {
  const zip = new JSZip()
  const fixed = documentXml.replace(
    '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
    '<w:p w14:paraId="C1C2C3D5"><w:r><w:t>See </w:t></w:r><w:hyperlink r:id="rId50"><w:r><w:t>the report</w:t></w:r></w:hyperlink><w:r><w:t> today</w:t></w:r></w:p>' +
      '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
  )
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', rootRelationshipsXml)
  zip.file('word/document.xml', fixed)
  zip.file(
    'word/_rels/document.xml.rels',
    documentRelationshipsXml.replace(
      '</Relationships>',
      '<Relationship Id="rId50" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.co.uk/report" TargetMode="External"/></Relationships>',
    ),
  )
  zip.file('word/styles.xml', stylesXml)
  zip.file('word/numbering.xml', numberingXml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function parseLinkedFixture() {
  return parseDocx(await linkedFixtureBytes())
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}
