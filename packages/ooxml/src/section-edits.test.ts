import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'

import { buildOoxmlFixture } from '../fixtures/builder'

import {
  applyDocumentEdits,
  canonicaliseParagraphIdentities,
  parseDocx,
  patchSectionPropertiesXml,
  serialiseDocx,
} from './index'
import {
  documentXml,
  load,
  paragraphs as paragraphWires,
  save,
} from './model-run-emphasis.test-support'
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

  it('materialises a run-keyed property write before a page break inside it', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Hello world']))
    const paragraph = mainParagraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Synthetic run is missing.')
    // A collapsed-caret toggle is run-keyed and writes no text, so only the
    // run-keyed overlay key can tell the break path to materialise. Otherwise
    // the reopened tail run comes from the parse-time `runProperties` snapshot
    // and saves unstyled while the paint claims the whole run is bold.
    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 5,
        kind: 'page',
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml).toContain('<w:br w:type="page"/>')
    expect(xml.match(/<w:rPr>/gu)).toHaveLength(1)
    const runs = mainParagraphs(await parseDocx(output))[0]?.runs ?? []
    expect(runs.map((item) => item.text).join('')).toBe('Hello world')
    expect(
      runs.every((item) =>
        /<w:b\b(?![^>]*w:val="0")/u.test(item.preservedXmlFragments.join('')),
      ),
    ).toBe(true)
  })

  it.each(['<w:p/>', '<w:p></w:p>'])(
    'composes a page break and a section break on %s',
    async (empty) => {
      for (const order of ['page', 'section'] as const) {
        const document = await load(empty)
        const paragraph = paragraphWires(document)[0]
        if (!paragraph) throw new Error('Fixture is missing.')
        const page = {
          type: 'insert_break',
          paragraphId: paragraph.id,
          offset: 0,
          kind: 'page',
        } as const
        const section = {
          type: 'insert_section_break',
          paragraphId: paragraph.id,
        } as const
        applyDocumentEdits(
          document,
          order === 'page' ? [page, section] : [section, page],
        )
        const xml = await documentXml(document)
        expect(xml).toContain(
          '<w:pPr><w:sectPr/></w:pPr><w:r><w:br w:type="page"/></w:r>',
        )
        expect(xml.indexOf('<w:pPr>')).toBeLessThan(xml.indexOf('<w:r><w:br'))
        const reloaded = await save(document)
        const reloadedParagraph = paragraphWires(reloaded)[0]
        expect(reloadedParagraph?.preservedXmlFragments.join('')).toContain(
          '<w:sectPr',
        )
        expect(
          (reloadedParagraph?.runs ?? [])
            .flatMap((item) => item.preservedXmlFragments)
            .join(''),
        ).toContain('w:type="page"')
      }
    },
  )

  it('orders a paragraph style before a section break in a property-less paragraph', async () => {
    const document = await load('<w:p><w:r><w:t>text</w:t></w:r></w:p>')
    const paragraph = paragraphWires(document)[0]
    if (!paragraph) throw new Error('Fixture is missing.')
    applyDocumentEdits(document, [
      { type: 'insert_section_break', paragraphId: paragraph.id },
      {
        type: 'set_paragraph_style',
        paragraphId: paragraph.id,
        styleId: 'Heading1',
      },
    ])
    const xml = await documentXml(document)
    expect(xml).toContain(
      '<w:pPr><w:pStyle w:val="Heading1"/><w:sectPr/></w:pPr>',
    )
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

  it('places a page break at the exact offset inside a later run', async () => {
    const document = await load(
      '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>',
    )
    const paragraph = paragraphWires(document)[0]
    const runs = paragraph?.runs ?? []
    if (!paragraph || !runs[1]) throw new Error('Fixture is missing.')
    // Rewriting the second run's text means the break materialises it, so the
    // paragraph-level offset must be converted to a run-local one.
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: runs[1].id, text: 'worldly' },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 9,
        kind: 'page',
      },
    ])
    const xml = await documentXml(document)
    expect(xml).toContain(
      '<w:r><w:t>wor</w:t><w:br w:type="page"/><w:t>ldly</w:t></w:r>',
    )
    expect(
      paragraphWires(await save(document))[0]
        ?.runs.map((run) => run.text)
        .join(''),
    ).toBe('Hello worldly')
  })

  it('places two materialised page breaks across runs at their offsets', async () => {
    const document = await load(
      '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>',
    )
    const paragraph = paragraphWires(document)[0]
    const runs = paragraph?.runs ?? []
    if (!paragraph || !runs[0] || !runs[1]) throw new Error('Fixture missing.')
    // Both runs are rewritten, so each break takes the materialise path; the
    // offsets 3 and 9 are inside the first and second run respectively.
    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: runs[0].id, text: 'Hello ' },
      { type: 'replace_run_text', runId: runs[1].id, text: 'worldly' },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 9,
        kind: 'page',
      },
      {
        type: 'insert_break',
        paragraphId: paragraph.id,
        offset: 3,
        kind: 'page',
      },
    ])
    const xml = await documentXml(document)
    expect(xml.split('<w:br w:type="page"/>').length - 1).toBe(2)
    expect(xml).toContain(
      '<w:r><w:t>Hel</w:t><w:br w:type="page"/><w:t xml:space="preserve">lo </w:t></w:r>',
    )
    expect(xml).toContain(
      '<w:r><w:t>wor</w:t><w:br w:type="page"/><w:t>ldly</w:t></w:r>',
    )
    expect(
      paragraphWires(await save(document))[0]
        ?.runs.map((run) => run.text)
        .join(''),
    ).toBe('Hello worldly')
  })

  it('expands a self-closing empty paragraph to hold a section break', async () => {
    const document = await load('<w:p/>')
    const paragraph = paragraphWires(document)[0]
    if (!paragraph) throw new Error('Fixture is missing.')
    applyDocumentEdits(document, [
      { type: 'insert_section_break', paragraphId: paragraph.id },
    ])
    const xml = await documentXml(document)
    expect(xml).toContain('<w:p><w:pPr><w:sectPr/></w:pPr></w:p>')
    expect(xml).not.toContain('<w:p/><w:pPr>')
    const reloaded = await save(document)
    expect(
      paragraphWires(reloaded)[0]?.preservedXmlFragments.join(''),
    ).toContain('<w:sectPr')
  })

  it('keeps paragraph identity when a section break expands a self-closing paragraph', async () => {
    const document = await loadDeclaring('<w:p w14:paraId="AABBCCDD"/>')
    const paragraph = paragraphWires(document)[0]
    if (!paragraph) throw new Error('Fixture is missing.')
    applyDocumentEdits(document, [
      { type: 'insert_section_break', paragraphId: paragraph.id },
    ])
    // A save canonicalises identity after the edit; the identity must fold into
    // the expansion instead of writing a second replacement over the same
    // range, which would fail to serialise.
    canonicaliseParagraphIdentities(document)
    const xml = await documentXml(document)
    expect(xml).toContain(
      '<w:p w14:paraId="AABBCCDD"><w:pPr><w:sectPr/></w:pPr></w:p>',
    )
  })

  it('refuses a section break on a paragraph that already ends a section', async () => {
    const document = await load(
      '<w:p><w:pPr><w:sectPr><w:pgSz w:w="8000" w:h="6000"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>Hello</w:t></w:r></w:p>',
    )
    const paragraph = paragraphWires(document)[0]
    if (!paragraph) throw new Error('Fixture is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'insert_section_break', paragraphId: paragraph.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
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

/** Parses a body with `w14` declared, so a `w14:paraId` fixture is valid. */
async function loadDeclaring(paragraphXml: string) {
  const base = await buildOoxmlFixture('full-fidelity-with-w14-ids')
  const zip = await JSZip.loadAsync(base)
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">' +
    `<w:body>${paragraphXml}</w:body></w:document>`
  zip.file('word/document.xml', documentXml)
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
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
