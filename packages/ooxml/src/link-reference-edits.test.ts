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
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

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

    // The covered piece of the split run carries the link on the wire.
    expect(
      anchor.runs.find((run) => run.text === 'Alice')?.hyperlinkTarget,
    ).toBe('https://example.co.uk/authority')
    expect(
      anchor.runs.find((run) => run.text === ' Example overview')
        ?.hyperlinkTarget,
    ).toBeUndefined()

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
    // The reader resolves the stored w:hyperlink back onto its runs.
    expect(
      paragraph?.runs.find((run) => run.text === 'Alice')?.hyperlinkTarget,
    ).toBe('https://example.co.uk/authority')
    expect(
      paragraph?.runs.find((run) => run.text === ' Example overview')
        ?.hyperlinkTarget,
    ).toBeUndefined()
  })

  it('reads a stored hyperlink onto the runs it wraps', async () => {
    const document = await parseMultiRunFixture()
    const paragraph = mainParagraphs(document).find((item) =>
      item.runs.some((run) => run.text === 'the report'),
    )
    if (!paragraph) throw new Error('Linked paragraph is missing.')
    expect(
      paragraph.runs.map((run) => [run.text, run.hyperlinkTarget]),
    ).toEqual([
      ['See ', undefined],
      ['the report', 'https://example.co.uk/report'],
      [' today', undefined],
    ])
  })

  it('leaves a non-allowlisted stored target off the wire untouched', async () => {
    const input = await hostileLinkFixtureBytes()
    const document = await parseDocx(input)
    const hostile = mainParagraphs(document).find((item) =>
      item.runs.some((run) => run.text === 'this'),
    )
    // The javascript: relationship resolves to nothing on the wire, while
    // the same document's https link still paints.
    expect(
      hostile?.runs.find((run) => run.text === 'this')?.hyperlinkTarget,
    ).toBeUndefined()
    const linked = mainParagraphs(document).find((item) =>
      item.runs.some((run) => run.text === 'the report'),
    )
    expect(
      linked?.runs.find((run) => run.text === 'the report')?.hyperlinkTarget,
    ).toBe('https://example.co.uk/report')

    // The source .rels stay byte-preserved: fidelity is unaffected, only the
    // painted link is dropped.
    const output = await serialiseDocx(document)
    expect(await zipText(output, 'word/_rels/document.xml.rels')).toBe(
      await zipText(input, 'word/_rels/document.xml.rels'),
    )
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
    // The unwrapped run drops the link on the wire and after a reparse.
    expect(anchor.runs.some((run) => run.hyperlinkTarget)).toBe(false)
    expect(paragraph?.runs.some((run) => run.hyperlinkTarget)).toBe(false)
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
  it('inserts a REF field and a part-allocated bookmark on the target', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const target = paragraphs[1]
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    // The fixture holds no _Ref_* name, so the first allocation is _Ref_1.
    const bookmark = '_Ref_1'
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

  it('reuses the same bookmark for a second reference to one target', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const other = paragraphs[1]
    const target = paragraphs[5]
    if (!anchor || !other || !target) {
      throw new Error('Fixture model is missing.')
    }
    const bookmark = '_Ref_1'

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

  it('gives distinct bookmark ids to two references in one batch', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const first = paragraphs[0]
    const second = paragraphs[1]
    const target = paragraphs[5]
    const otherTarget = paragraphs[6]
    if (!first || !second || !target || !otherTarget) {
      throw new Error('Fixture model is missing.')
    }
    applyDocumentEdits(document, [
      {
        type: 'insert_cross_reference',
        paragraphId: first.id,
        offset: 0,
        targetParagraphId: target.id,
      },
      {
        type: 'insert_cross_reference',
        paragraphId: second.id,
        offset: 0,
        targetParagraphId: otherTarget.id,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    const ids = [
      ...xml.matchAll(
        /<w:bookmarkStart[^>]*\bw:id="(\d+)"[^>]*\bw:name="_Ref_/gu,
      ),
    ].map((match) => match[1])
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    // Each REF instruction resolves its own bookmark.
    const fields = [...xml.matchAll(/REF (_Ref_\d+) /gu)].map(
      (match) => match[1],
    )
    expect(new Set(fields).size).toBe(2)
  })

  it('allocates bookmark names that survive an encounter-order id shift', async () => {
    // Without w14:paraId the wire ids are encounter-order para-NNNNNN, so a
    // paragraph inserted before the target shifts every later id on the next
    // parse. A name derived from the wire id would then be written a second
    // time on a different paragraph.
    const first = await parseDocx(
      await buildOoxmlFixture('full-fidelity-without-w14-ids'),
    )
    const firstParagraphs = mainParagraphs(first)
    const host = firstParagraphs[0]
    const target = firstParagraphs[1]
    if (!host || !target) throw new Error('Fixture model is missing.')
    const shiftedId = target.id
    applyDocumentEdits(first, [
      {
        type: 'insert_cross_reference',
        paragraphId: host.id,
        offset: 0,
        targetParagraphId: target.id,
      },
    ])
    const saved = await serialiseDocx(first)

    const second = await parseDocx(saved)
    const insertBefore = mainParagraphs(second).find(
      (paragraph) => paragraph.id === shiftedId,
    )
    if (!insertBefore) throw new Error('Target paragraph is missing.')
    applyDocumentEdits(second, [
      {
        type: 'insert_paragraph_before',
        paragraphId: insertBefore.id,
        text: 'Inserted before the target',
      },
    ])
    const shifted = await serialiseDocx(second)

    const third = await parseDocx(shifted)
    const thirdParagraphs = mainParagraphs(third)
    const nowHoldingId = thirdParagraphs.find(
      (paragraph) => paragraph.id === shiftedId,
    )
    const thirdHost = thirdParagraphs.find(
      (paragraph) => paragraph.id === host.id,
    )
    if (!nowHoldingId || !thirdHost) {
      throw new Error('Fixture model is missing.')
    }
    // The wire id moved: this is a different paragraph than the save-1 target.
    expect(nowHoldingId.runs.map((run) => run.text).join('')).toBe(
      'Inserted before the target',
    )
    applyDocumentEdits(third, [
      {
        type: 'insert_cross_reference',
        paragraphId: thirdHost.id,
        offset: 0,
        targetParagraphId: nowHoldingId.id,
      },
    ])
    const output = await serialiseDocx(third)
    const xml = await zipText(output, 'word/document.xml')

    const starts = [
      ...xml.matchAll(/<w:bookmarkStart[^>]*\bw:name="(_Ref_[^"]*)"/gu),
    ]
    expect(starts).toHaveLength(2)
    expect(starts[0]?.[1]).not.toBe(starts[1]?.[1])
    // Each bookmarkStart sits inside a different paragraph.
    const positions = starts.map((match) => match.index)
    const paragraphOf = (index: number) =>
      xml.slice(0, index).split('</w:p>').length
    expect(paragraphOf(positions[0] ?? 0)).not.toBe(
      paragraphOf(positions[1] ?? 0),
    )
  })

  it('composes a bookmark on the target with a picture spliced into it', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const target = paragraphs[1]
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    expect(target.runs.map((run) => run.text).join('')).toBe('Restarted list')

    applyDocumentEdits(document, [
      {
        type: 'insert_cross_reference',
        paragraphId: anchor.id,
        offset: 6,
        targetParagraphId: target.id,
      },
      {
        type: 'insert_image',
        paragraphId: target.id,
        offset: 3,
        contentType: 'image/png',
        dataBase64: PNG_BASE64,
        widthPx: 10,
        heightPx: 10,
        name: 'Figure',
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    // The bookmark wraps the target's content and the drawing run survives.
    expect(xml).toContain('<w:bookmarkStart w:id="5" w:name="_Ref_1"/>')
    expect(xml).toContain('<w:drawing>')
    const reparsed = mainParagraphs(await parseDocx(output))
    const targetWire = reparsed.find((item) => item.id === target.id)
    expect(
      targetWire?.runs.some((run) =>
        run.preservedXmlFragments.some((fragment) =>
          fragment.includes('<w:drawing'),
        ),
      ),
    ).toBe(true)
    expect(targetWire?.runs.map((run) => run.text).join('')).toBe(
      'Restarted list',
    )
    expect(
      targetWire?.preservedXmlFragments.some((fragment) =>
        fragment.includes('w:name="_Ref_1"'),
      ),
    ).toBe(true)
  })

  it('rejects a cross-reference whose target is deleted later in the batch', async () => {
    // The client emits deletions last, so the reference is planned before
    // the delete that removes its target — the batch-order check must read
    // the whole planned delete set, not only deletes already applied.
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs[0]
    const target = paragraphs[5]
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_cross_reference',
          paragraphId: anchor.id,
          offset: 0,
          targetParagraphId: target.id,
        },
        { type: 'delete_paragraph', paragraphId: target.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
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
  it('refuses a splice landing inside a stored hyperlink', async () => {
    const document = await parseMultiRunFixture()
    const paragraphs = mainParagraphs(document)
    const anchor = paragraphs.find((paragraph) =>
      paragraph.runs.some((run) => run.text.includes('See')),
    )
    const target = paragraphs.find((paragraph) => paragraph.id !== anchor?.id)
    if (!anchor || !target) throw new Error('Fixture model is missing.')
    // 'See ' [0,4) 'the report' [4,14) ' today' [14,20): 8 sits inside the
    // stored w:hyperlink, 2 sits before it.
    const nested: DocumentEditOperation[] = [
      {
        type: 'insert_cross_reference',
        paragraphId: anchor.id,
        offset: 8,
        targetParagraphId: target.id,
      },
      {
        type: 'insert_image',
        paragraphId: anchor.id,
        offset: 8,
        contentType: 'image/png',
        dataBase64: PNG_BASE64,
        widthPx: 10,
        heightPx: 10,
        name: 'Figure',
      },
    ]
    for (const operation of nested) {
      expect(() => applyDocumentEdits(document, [operation])).toThrowError(
        expect.objectContaining({ code: 'invalid-document-edit' }),
      )
    }
    // A splice before the link still composes.
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'insert_image',
          paragraphId: anchor.id,
          offset: 2,
          contentType: 'image/png',
          dataBase64: PNG_BASE64,
          widthPx: 10,
          heightPx: 10,
          name: 'Figure',
        },
      ]),
    ).not.toThrow()
  })

  it('refuses a splice into pending text inside a stored link the wire cannot see', async () => {
    // An internal w:anchor link resolves no r:id, and a non-allowlisted
    // target is dropped at parse: neither sets hyperlinkTarget on the run's
    // wire, so only the element check can refuse the pending-path splice.
    for (const fixture of [internalLinkFixtureBytes, hostileLinkFixtureBytes]) {
      const document = await parseDocx(await fixture())
      const paragraphs = mainParagraphs(document)
      const anchor = paragraphs.find((paragraph) =>
        paragraph.runs.some((run) => run.text === 'this'),
      )
      const target = paragraphs.find((paragraph) => paragraph.id !== anchor?.id)
      const linked = anchor?.runs.find((run) => run.text === 'this')
      if (!anchor || !target || !linked) {
        throw new Error('Fixture model is missing.')
      }
      expect(linked.hyperlinkTarget).toBeUndefined()
      // 'Open ' [0,5) 'this' [5,9): 7 stays inside the linked run after the
      // text edit, so the splice takes the pending-run path.
      expect(() =>
        applyDocumentEdits(document, [
          { type: 'replace_run_text', runId: linked.id, text: 'thas' },
          {
            type: 'insert_cross_reference',
            paragraphId: anchor.id,
            offset: 7,
            targetParagraphId: target.id,
          },
        ]),
      ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    }
  })

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

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

/**
 * The shared fixture's text runs are single-run paragraphs; this variant adds
 * a three-run paragraph for span coverage and a stored hyperlink paragraph
 * for unwrap coverage.
 */
function multiRunFixtureBytes() {
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
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

async function parseMultiRunFixture() {
  return parseDocx(await multiRunFixtureBytes())
}

/**
 * An internal `w:anchor` hyperlink carries no `r:id`, so its run carries no
 * target on the wire while the element still wraps it.
 */
function internalLinkFixtureBytes() {
  const zip = new JSZip()
  const fixed = documentXml.replace(
    '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
    '<w:p w14:paraId="B1B2C3D8"><w:r><w:t>Open </w:t></w:r><w:hyperlink w:anchor="Toc1"><w:r><w:t>this</w:t></w:r></w:hyperlink></w:p>' +
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

/**
 * Two stored links in one document: an allowlisted target and a `javascript:`
 * target, so the allowlist is proven selective rather than a blanket drop.
 */
function hostileLinkFixtureBytes() {
  const zip = new JSZip()
  const fixed = documentXml.replace(
    '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
    '<w:p w14:paraId="B1B2C3D6"><w:r><w:t>Open </w:t></w:r><w:hyperlink r:id="rId51"><w:r><w:t>this</w:t></w:r></w:hyperlink></w:p>' +
      '<w:p w14:paraId="B1B2C3D7"><w:r><w:t>See </w:t></w:r><w:hyperlink r:id="rId52"><w:r><w:t>the report</w:t></w:r></w:hyperlink></w:p>' +
      '<w:p><w:fldSimple w:instr=" STYLEREF Heading1 ">',
  )
  zip.file('[Content_Types].xml', contentTypesXml)
  zip.file('_rels/.rels', rootRelationshipsXml)
  zip.file('word/document.xml', fixed)
  zip.file(
    'word/_rels/document.xml.rels',
    documentRelationshipsXml.replace(
      '</Relationships>',
      '<Relationship Id="rId51" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>' +
        '<Relationship Id="rId52" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.co.uk/report" TargetMode="External"/></Relationships>',
    ),
  )
  zip.file('word/styles.xml', stylesXml)
  zip.file('word/numbering.xml', numberingXml)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
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
