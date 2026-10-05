import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'

import { buildOoxmlFixture } from '../fixtures/builder'

import {
  applyDocumentEdits,
  parseDocx,
  patchSectionPropertiesXml,
  serialiseDocx,
} from './index'
import { createSyntheticDocx } from './synthetic-document'

describe('OOXML section and break edits', () => {
  it('writes margins and an explicit page size to the body sectPr', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello world']))
    applyDocumentEdits(document, [
      {
        type: 'set_section_properties',
        margins: {
          top: 720,
          right: 1080,
          bottom: 720,
          left: 1080,
          header: 360,
          footer: 360,
        },
        pageSize: { width: 12_240, height: 15_840 },
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain(
      '<w:pgMar w:top="720" w:right="1080" w:bottom="720" w:left="1080" w:header="360" w:footer="360"/>',
    )
    expect(xml).toContain('<w:pgSz w:w="12240" w:h="15840"/>')

    const story = documentStory(await parseDocx(output))
    expect(story?.preservedXmlFragments.join('')).toContain(
      'w:pgMar w:top="720"',
    )
  })

  it('swaps width and height for landscape and derives orientation from a size', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello']))
    applyDocumentEdits(document, [
      {
        type: 'set_section_properties',
        pageSize: { width: 11_906, height: 16_838 },
      },
      { type: 'set_section_properties', orientation: 'landscape' },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('w:w="16838" w:h="11906"')
    expect(xml).toContain('w:orient="landscape"')
  })

  it('releases a single margin attribute with a null field', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello']))
    // The reading-side default carries no pgMar; a later null must not create one.
    applyDocumentEdits(document, [
      { type: 'set_section_properties', margins: { top: 720, left: null } },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:pgMar w:top="720"/>')
  })

  it('preserves headers, footers, columns and every unrelated paragraph', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const before = await partBytes(input)
    applyDocumentEdits(document, [
      { type: 'set_section_properties', margins: { top: 1440 } },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('<w:headerReference w:type="default" r:id="rId5"/>')
    expect(xml).toContain('<w:footerReference w:type="default" r:id="rId6"/>')
    // The earlier paragraph-level section is untouched.
    expect(xml).toContain(
      '<w:sectPr><w:headerReference w:type="default" r:id="rId3"/>',
    )
    const after = await partBytes(output)
    for (const name of [
      'word/header1.xml',
      'word/footer1.xml',
      'word/_rels/document.xml.rels',
      '[Content_Types].xml',
    ]) {
      expect(after.get(name)).toEqual(before.get(name))
    }
  })

  it('splits a run to place a page break at the caret offset', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello world']))
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Synthetic paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 5,
        kind: 'page',
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain(
      '<w:r><w:t xml:space="preserve">Hello</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t xml:space="preserve"> world</w:t></w:r>',
    )

    const reloaded = mainParagraphs(await parseDocx(output))[0]
    expect(reloaded?.runs.map((run) => run.text).join('')).toBe('Hello world')
    const structure = [
      ...(reloaded?.preservedXmlFragments ?? []),
      ...(reloaded?.runs.flatMap((run) => run.preservedXmlFragments) ?? []),
    ].join('')
    expect(structure).toContain('<w:br w:type="page"/>')
  })

  it('composes a page break with a pending text replacement on the same run', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello world']))
    const paragraph = mainParagraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Synthetic run is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Hello brave world' },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 6,
        kind: 'page',
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain(
      '<w:t xml:space="preserve">Hello </w:t><w:br w:type="page"/><w:t>brave world</w:t>',
    )
    expect(
      mainParagraphs(await parseDocx(output))[0]
        ?.runs.map((run) => run.text)
        .join(''),
    ).toBe('Hello brave world')
  })

  it('appends a page break run at the end of an empty-length paragraph', async () => {
    const document = await parseDocx(await createSyntheticDocx(['']))
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Synthetic paragraph is missing.')
    applyDocumentEdits(document, [
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 0,
        kind: 'page',
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:r><w:br w:type="page"/></w:r>')
  })

  it('inserts a paragraph-level section break seeded from the body section', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_section_break', paragraphId: paragraph.id },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain(
      '<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:sectPr><w:headerReference w:type="default" r:id="rId5"/><w:footerReference w:type="default" r:id="rId6"/></w:sectPr></w:pPr>',
    )

    const reloaded = await parseDocx(output)
    const reloadedParagraph = mainParagraphs(reloaded)[0]
    expect(reloadedParagraph?.preservedXmlFragments.join('')).toContain(
      '<w:sectPr><w:headerReference w:type="default" r:id="rId5"/>',
    )
    expect(documentStory(reloaded)?.preservedXmlFragments.join('')).toContain(
      '<w:sectPr><w:headerReference w:type="default" r:id="rId5"/>',
    )
  })

  it('fails closed when a section or break edit is asked to be tracked', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello']))
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Synthetic paragraph is missing.')
    const tracking = {
      author: 'Alice Example',
      date: '2026-08-10T10:00:00.000Z',
    }
    expect(() =>
      applyDocumentEdits(
        document,
        [{ type: 'set_section_properties', margins: { top: 720 } }],
        tracking,
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
    expect(() =>
      applyDocumentEdits(
        document,
        [
          {
            type: 'insert_break',
            paragraphId: paragraph.id,
            offset: 0,
            kind: 'page',
          },
        ],
        tracking,
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('rejects a page-break offset past the paragraph text', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hi']))
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Synthetic paragraph is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 5,
          kind: 'page',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('validates the break offset against the appended effective text', async () => {
    // The ordinary flow: type to lengthen the run, caret at the end, insert a
    // break. The plan pass cannot bound this against the pre-batch text.
    const document = await parseDocx(await createSyntheticDocx(['Hello']))
    const paragraph = mainParagraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Synthetic run is missing.')
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Hello world' },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 11,
        kind: 'page',
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:br w:type="page"/>')
    expect(
      mainParagraphs(await parseDocx(await serialiseDocx(document)))[0]
        ?.runs.map((item) => item.text)
        .join(''),
    ).toBe('Hello world')
  })

  it('rejects a break offset inside a surrogate pair', async () => {
    const document = await parseDocx(await createSyntheticDocx(['a😀b']))
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Synthetic paragraph is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 2,
          kind: 'page',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('composes two page breaks in one run without overlapping', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello world']))
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Synthetic paragraph is missing.')
    applyDocumentEdits(document, [
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 3,
        kind: 'page',
      },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 6,
        kind: 'page',
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml.split('<w:br w:type="page"/>').length - 1).toBe(2)
    expect(
      mainParagraphs(await parseDocx(await serialiseDocx(document)))[0]
        ?.runs.map((item) => item.text)
        .join(''),
    ).toBe('Hello world')
  })

  it('composes a run-property write and a page break in one run', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello world']))
    const paragraph = mainParagraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Synthetic run is missing.')
    // Highlight applied before the break is the order collectFormatOperations
    // produces; materialising the run must fold the run-property write, not
    // overlap it.
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Hello brave world' },
      { type: 'set_run_emphasis', runId: run.id, highlight: 'yellow' },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 6,
        kind: 'page',
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:br w:type="page"/>')
    expect(xml).toContain('w:highlight w:val="yellow"')
    expect(
      mainParagraphs(await parseDocx(await serialiseDocx(document)))[0]
        ?.runs.map((item) => item.text)
        .join(''),
    ).toBe('Hello brave world')
  })

  it('patches the live section, never the recorded sectPrChange copy', () => {
    const sect =
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440"/>' +
      '<w:sectPrChange w:id="1"><w:sectPr><w:pgSz w:w="9000" w:h="9000"/><w:pgMar w:top="100"/></w:sectPr></w:sectPrChange>' +
      '</w:sectPr>'
    const next = patchSectionPropertiesXml(sect, { margins: { top: 720 } })
    // The live section is patchable and the history copy is preserved verbatim.
    expect(next).toContain('<w:pgMar w:top="720"/>')
    expect(next).toContain(
      '<w:sectPrChange w:id="1"><w:sectPr><w:pgSz w:w="9000" w:h="9000"/><w:pgMar w:top="100"/></w:sectPr></w:sectPrChange>',
    )
    expect(next).toContain('<w:pgSz w:w="11906" w:h="16838"/>')
  })

  it('seeds a same-batch section break from the patched section', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello']))
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Synthetic paragraph is missing.')
    applyDocumentEdits(document, [
      { type: 'set_section_properties', margins: { top: 720 } },
      { type: 'insert_section_break', paragraphId: paragraph.id },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const seeded = xml.match(
      /<w:pPr><w:sectPr>[\s\S]*?<\/w:sectPr><\/w:pPr>/u,
    )?.[0]
    expect(seeded).toContain('w:top="720"')
  })
})

function documentStory(document: Awaited<ReturnType<typeof parseDocx>>) {
  return document.model.stories.find((story) => story.kind === 'document')
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return documentStory(document)?.paragraphs ?? []
}

async function zipText(input: Uint8Array, partName: string) {
  const zip = await JSZip.loadAsync(input)
  const part = zip.file(partName)
  if (!part) throw new Error(`${partName} is missing.`)
  return part.async('string')
}

async function partBytes(input: Uint8Array) {
  const zip = await JSZip.loadAsync(input)
  const parts = new Map<string, string>()
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    parts.set(name, await entry.async('string'))
  }
  return parts
}
