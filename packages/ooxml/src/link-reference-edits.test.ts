import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import type { DocumentEditOperation } from '@obiter/contracts'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  contentTypesXml,
  documentRelationshipsXml,
  documentXml,
  numberingXml,
  rootRelationshipsXml,
  stylesXml,
} from '../fixtures/fixture-parts'

import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

const TRACKING = { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' }

describe('hyperlink edits', () => {
  it('wraps a mid-run range in w:hyperlink with an external relationship', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_hyperlink',
        paragraphId: anchor.id,
        from: 0,
        to: 5,
        target: 'https://example.co.uk/authority',
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    const link = xml.match(/<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/u)?.[0] ?? ''
    const relId = /r:id="(rId\d+)"/u.exec(link)?.[1]
    expect(relId).toBeDefined()
    expect(link).toContain('Alice')
    expect(link).not.toContain('Example overview')
    // The untouched tail keeps its own run element after the link closes.
    expect(xml).toContain('Example overview')

    const rels = await zipText(output, 'word/_rels/document.xml.rels')
    const relationship = rels.match(
      new RegExp(`<Relationship[^>]*Id="${relId ?? 'missing'}"[^>]*/>`, 'u'),
    )?.[0]
    expect(relationship).toContain('/relationships/hyperlink')
    expect(relationship).toContain('TargetMode="External"')
    expect(relationship).toContain('Target="https://example.co.uk/authority"')

    const reparsed = mainParagraphs(await parseDocx(output))
    const paragraph = reparsed.find((item) => item.id === anchor.id)
    expect(paragraph?.runs.map((run) => run.text).join('')).toBe(
      'Alice Example overview',
    )
    expect(
      paragraph?.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:hyperlink'),
      ),
    ).toBe(true)
  })

  it('wraps a range spanning several runs in one hyperlink', async () => {
    const document = await parseMultiRunFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('Alpha')),
    )
    if (!anchor) throw new Error('Multi-run paragraph is missing.')

    // 'Alpha bravo charlie': [4, 14) covers 'a bravo ch' across three runs.
    applyDocumentEdits(document, [
      {
        type: 'set_hyperlink',
        paragraphId: anchor.id,
        from: 4,
        to: 14,
        target: 'mailto:clerk@example.co.uk',
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // Scope to the edited paragraph: the fixture carries a stored hyperlink
    // for the unwrap tests.
    const paragraphXml = xml.slice(
      xml.indexOf('B1B2C3D4'),
      xml.indexOf('</w:p>', xml.indexOf('B1B2C3D4')),
    )
    const links =
      paragraphXml.match(/<w:hyperlink\b[\s\S]*?<\/w:hyperlink>/gu) ?? []
    expect(links).toHaveLength(1)
    const link = links[0] ?? ''
    // Interior markup is preserved byte-for-byte: the boundary pieces keep
    // their run elements and the middle run is untouched inside the wrap.
    expect(link.match(/<w:r>/gu)).toHaveLength(3)
    expect(link).toContain('a ')
    expect(link).toContain('bravo')
    expect(link).toContain('ch')
    expect(paragraphXml).toContain('Alph')
    expect(paragraphXml).toContain('arlie')

    const reparsed = mainParagraphs(await parseDocx(output))
    const paragraph = reparsed.find((item) => item.id === anchor.id)
    expect(paragraph?.runs.map((run) => run.text).join('')).toBe(
      'Alpha bravo charlie',
    )
  })

  it('unwraps a stored hyperlink, drops the relationship and keeps the text', async () => {
    const document = await parseMultiRunFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('See')),
    )
    if (!anchor) throw new Error('Linked paragraph is missing.')
    const before = anchor.runs.map((run) => run.text).join('')
    expect(before).toBe('See the report today')

    // [4, 14) is 'the report' — the range the stored hyperlink covers.
    applyDocumentEdits(document, [
      {
        type: 'set_hyperlink',
        paragraphId: anchor.id,
        from: 4,
        to: 14,
        target: null,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    expect(xml).not.toContain('<w:hyperlink')
    expect(xml).toContain('See ')
    expect(xml).toContain('the report')
    expect(xml).toContain(' today')
    const rels = await zipText(output, 'word/_rels/document.xml.rels')
    expect(rels).not.toContain('Id="rId50"')
    expect(rels).not.toContain('/relationships/hyperlink')

    const reparsed = mainParagraphs(await parseDocx(output))
    const paragraph = reparsed.find((item) => item.id === anchor.id)
    expect(paragraph?.runs.map((run) => run.text).join('')).toBe(
      'See the report today',
    )
    expect(
      document.model.relationships.some((wire) => wire.id === 'rId50'),
    ).toBe(false)
  })

  it('refuses to nest a hyperlink over a stored hyperlink', async () => {
    const document = await parseMultiRunFixture()
    const anchor = mainParagraphs(document).find((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('See')),
    )
    if (!anchor) throw new Error('Linked paragraph is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'set_hyperlink',
          paragraphId: anchor.id,
          from: 4,
          to: 14,
          target: 'https://example.co.uk/other',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a removal where no hyperlink covers the range', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'set_hyperlink',
          paragraphId: anchor.id,
          from: 0,
          to: 5,
          target: null,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })
})

describe('cross-reference edits', () => {
  it('inserts a REF field and a derived bookmark on the target', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const target = paragraphs[1]
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    const bookmark = bookmarkName(target.id)
    expect(target.runs.map((run) => run.text).join('')).toBe('Restarted list')

    applyDocumentEdits(document, [
      {
        type: 'insert_cross_reference',
        paragraphId: anchor.id,
        offset: 6,
        targetParagraphId: target.id,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // begin / instrText / separate / result / end at the caret, in order.
    const field = xml.match(
      /<w:r><w:fldChar w:fldCharType="begin"\/><\/w:r>[\s\S]*?<w:fldChar w:fldCharType="end"\/><\/w:r>/u,
    )?.[0]
    expect(field).toContain(`REF ${bookmark}`)
    expect(field).toContain('Restarted list')
    expect(field).toContain('<w:instrText xml:space="preserve">')
    expect(field).toContain('w:fldCharType="separate"')
    // The field splits 'Alice Example overview' at offset 6.
    expect(xml.indexOf('Alice ')).toBeLessThan(xml.indexOf('fldCharType'))
    expect(xml).toContain('Example overview')

    // The bookmark wraps the target's runs, after its pPr.
    const bookmarkStart = `<w:bookmarkStart w:id="5" w:name="${bookmark}"/>`
    expect(xml).toContain(bookmarkStart)
    const targetOpen = xml.indexOf('Restarted list')
    expect(xml.lastIndexOf(bookmarkStart, targetOpen)).toBeLessThan(targetOpen)
    expect(
      xml.indexOf('<w:bookmarkEnd w:id="5"/>', targetOpen),
    ).toBeGreaterThan(targetOpen)

    const reparsed = mainParagraphs(await parseDocx(output))
    const targetWire = reparsed.find((item) => item.id === target.id)
    expect(
      targetWire?.preservedXmlFragments.some((fragment) =>
        fragment.includes(`w:name="${bookmark}"`),
      ),
    ).toBe(true)
    const anchorWire = reparsed.find((item) => item.id === anchor.id)
    // The result run's text joins the paragraph's effective text on reload.
    expect(anchorWire?.runs.map((run) => run.text).join('')).toBe(
      'Alice Restarted listExample overview',
    )
    expect(
      anchorWire?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('fldCharType="begin"'),
        ),
      ),
    ).toBe(true)
  })

  it('reuses the derived bookmark for a second reference to one target', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const other = paragraphs[1]
    const target = paragraphs[5]
    if (!anchor || !other || !target) {
      throw new Error('Fixture model is missing.')
    }
    const bookmark = bookmarkName(target.id)

    applyDocumentEdits(document, [
      {
        type: 'insert_cross_reference',
        paragraphId: anchor.id,
        offset: 0,
        targetParagraphId: target.id,
      },
      {
        type: 'insert_cross_reference',
        paragraphId: other.id,
        offset: 0,
        targetParagraphId: target.id,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    expect(xml.match(new RegExp(`w:name="${bookmark}"`, 'gu'))).toHaveLength(1)
    expect(xml.match(/<w:instrText/gu)).toHaveLength(2)
  })

  it('rejects a cross-reference whose target was deleted earlier in the batch', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const target = paragraphs[5]
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'delete_paragraph', paragraphId: target.id },
        {
          type: 'insert_cross_reference',
          paragraphId: anchor.id,
          offset: 0,
          targetParagraphId: target.id,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })
})

describe('structural link and reference refusals', () => {
  it('fails closed under tracked changes', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const target = paragraphs[5]
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    const operations: DocumentEditOperation[] = [
      {
        type: 'set_hyperlink',
        paragraphId: anchor.id,
        from: 0,
        to: 5,
        target: 'https://example.co.uk',
      },
      {
        type: 'insert_cross_reference',
        paragraphId: anchor.id,
        offset: 0,
        targetParagraphId: target.id,
      },
    ]
    for (const operation of operations) {
      expect(() =>
        applyDocumentEdits(document, [operation], TRACKING),
      ).toThrowError(
        expect.objectContaining({ code: 'model-node-not-editable' }),
      )
    }
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
        {
          type: 'set_hyperlink',
          paragraphId: tracked.id,
          from: 0,
          to: 1,
          target: 'https://example.co.uk',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_cross_reference',
          paragraphId: tracked.id,
          offset: 0,
          targetParagraphId: tracked.id,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('preserves unrelated package parts byte for byte', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const target = paragraphs[5]
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    applyDocumentEdits(document, [
      {
        type: 'set_hyperlink',
        paragraphId: anchor.id,
        from: 0,
        to: 5,
        target: 'https://example.co.uk',
      },
      {
        type: 'insert_cross_reference',
        paragraphId: paragraphs[9]?.id ?? '',
        offset: 0,
        targetParagraphId: target.id,
      },
    ])
    const output = await serialiseDocx(document)
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const before = await JSZip.loadAsync(input)
    const after = await JSZip.loadAsync(output)
    for (const name of [
      'word/styles.xml',
      'word/numbering.xml',
      'word/media/image1.png',
      'word/header1.xml',
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

function bookmarkName(wireId: string) {
  return `_Ref_${wireId.replace(/[^A-Za-z0-9_]/gu, '_')}`.slice(0, 40)
}

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

/**
 * The shared fixture's text runs are single-run paragraphs; this variant adds
 * a three-run paragraph for span coverage and a stored hyperlink paragraph
 * for unwrap coverage.
 */
async function parseMultiRunFixture() {
  const zip = new JSZip()
  const fixed = documentXml.replace(
    '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
    '<w:p w14:paraId="B1B2C3D4"><w:r><w:t>Alpha </w:t></w:r><w:r><w:t>bravo</w:t></w:r><w:r><w:t> charlie</w:t></w:r></w:p>' +
      '<w:p w14:paraId="B1B2C3D5"><w:r><w:t>See </w:t></w:r><w:hyperlink r:id="rId50"><w:r><w:t>the report</w:t></w:r></w:hyperlink><w:r><w:t> today</w:t></w:r></w:p>' +
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
  return parseDocx(
    await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
  )
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}
