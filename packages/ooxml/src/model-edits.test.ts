import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  parseDocx,
  serialiseDocx,
  validateCommentAnchor,
} from './index'

const decoder = new TextDecoder()

describe('OOXML document edits', () => {
  it('validates every target before applying any operation', async () => {
    const document = await parseFixture()
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    expect(() =>
      applyDocumentEdits(document, [
        { type: 'replace_run_text', runId: run.id, text: 'Revised' },
        {
          type: 'set_paragraph_style',
          paragraphId: 'missing',
          styleId: 'Base',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-found' }))
    expect(run.text).toBe('Alice Example overview')
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('escapes replacement text and preserves boundary whitespace', async () => {
    const document = await parseFixture()
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: ' <review & revise> ' },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')

    expect(xml).toContain(
      '<w:t xml:space="preserve"> &lt;review &amp; revise&gt; </w:t>',
    )
    expect(mainParagraphs(await parseDocx(output))[0]?.runs[0]?.text).toBe(
      ' <review & revise> ',
    )
  })

  it('rejects unsupported XML characters without mutating the model', async () => {
    const document = await parseFixture()
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    expect(() =>
      applyDocumentEdits(document, [
        { type: 'replace_run_text', runId: run.id, text: 'bad\u0000text' },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(run.text).toBe('Alice Example overview')
  })

  it('patches direct paragraph and run styles without dropping properties', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const first = paragraphs[0]
    const second = paragraphs[1]
    const third = paragraphs[2]
    const run = second?.runs[0]
    if (!first || !second || !third || !run) {
      throw new Error('Fixture model is missing.')
    }

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_style',
        paragraphId: first.id,
        styleId: null,
      },
      {
        type: 'set_paragraph_style',
        paragraphId: second.id,
        styleId: 'Base',
      },
      { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      {
        type: 'set_paragraph_style',
        paragraphId: third.id,
        styleId: 'Base',
      },
      {
        type: 'set_paragraph_style',
        paragraphId: third.id,
        styleId: null,
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    const reparsed = await parseDocx(output)
    const edited = mainParagraphs(reparsed)

    expect(xml).toContain('<w:numPr><w:ilvl w:val="0"/>')
    expect(edited[0]?.styleId).toBeUndefined()
    expect(edited[1]?.styleId).toBe('Base')
    expect(edited[1]?.runs[0]?.styleId).toBe('Heading1Char')
    expect(edited[2]?.styleId).toBeUndefined()
  })

  it('inserts and deletes paragraphs while keeping surviving ids stable', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const firstId = paragraphs[0]?.id
    const secondId = paragraphs[1]?.id
    if (!firstId || !secondId)
      throw new Error('Fixture paragraphs are missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: firstId,
        text: 'Inserted paragraph',
        styleId: 'Base',
      },
      {
        type: 'replace_run_text',
        runId: paragraphs[1]?.runs[0]?.id ?? '',
        text: 'Deleted revision',
      },
      { type: 'delete_paragraph', paragraphId: secondId },
    ])

    expect(mainParagraphs(document).slice(0, 2)).toMatchObject([
      { id: firstId },
      { id: 'para-edit-000001', styleId: 'Base' },
    ])
    expect(mainParagraphs(document).some(({ id }) => id === secondId)).toBe(
      false,
    )
    const reparsed = await parseDocx(await serialiseDocx(document))
    expect(mainParagraphs(reparsed)[0]?.id).toBe(firstId)
    expect(mainParagraphs(reparsed)[1]?.runs[0]?.text).toBe(
      'Inserted paragraph',
    )
  })

  it('inserts chained paragraphs after the same model anchor in visual order', async () => {
    const document = await parseSingleParagraphFixture()
    const firstId = mainParagraphs(document)[0]?.id
    if (!firstId) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: firstId,
        text: 'First',
      },
      {
        type: 'insert_paragraph_after',
        paragraphId: firstId,
        text: 'Second',
      },
    ])

    expect(
      mainParagraphs(document).map((paragraph) => paragraph.runs[0]?.text),
    ).toEqual(['Only', 'First', 'Second'])
  })

  it('serialises in-paragraph line breaks as w:br and reparses them', async () => {
    const document = await parseSingleParagraphFixture()
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'First\nSecond' },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    const reparsed = await parseDocx(output)

    expect(xml).toContain('</w:t><w:br/><w:t>Second</w:t>')
    expect(xml).not.toContain('First\nSecond')
    expect(mainParagraphs(reparsed)[0]?.runs[0]?.text).toBe('First\nSecond')
  })

  it('inserts a paragraph with a line break as w:br', async () => {
    const document = await parseSingleParagraphFixture()
    const firstId = mainParagraphs(document)[0]?.id
    if (!firstId) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'insert_paragraph_after',
        paragraphId: firstId,
        text: 'First\nSecond',
      },
    ])
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    const reparsed = await parseDocx(output)

    expect(xml).toContain('</w:t><w:br/><w:t>Second</w:t>')
    expect(mainParagraphs(reparsed)[1]?.runs[0]?.text).toBe('First\nSecond')
  })

  it('parses existing wrapping breaks without treating page breaks as newlines', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const zip = await JSZip.loadAsync(input)
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First</w:t><w:br/><w:t>Second</w:t></w:r></w:p><w:p><w:r><w:t>Keep</w:t><w:br w:type="page"/><w:t>Together</w:t></w:r></w:p></w:body></w:document>',
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const paragraphs = mainParagraphs(document)

    expect(paragraphs[0]?.runs[0]?.text).toBe('First\nSecond')
    expect(paragraphs[1]?.runs[0]?.text).toBe('KeepTogether')
    expect(paragraphs[1]?.runs[0]?.preservedXmlFragments).toContain(
      '<w:br w:type="page"/>',
    )
  })

  it('keeps interleaved run elements when a newline is introduced', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const zip = await JSZip.loadAsync(input)
    zip.file(
      'word/document.xml',
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>First</w:t><w:tab/><w:t>Second</w:t></w:r></w:p></w:body></w:document>',
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'First\nSecond' },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )

    expect(xml).toContain('<w:tab/>')
    expect(xml).toContain('</w:t><w:br/><w:t>Second</w:t>')
  })

  it('rejects non-main stories, missing styles, tracked paragraphs, and deleting the only paragraph', async () => {
    const document = await parseFixture()
    const headerRun = document.model.stories.find(
      ({ kind }) => kind === 'header',
    )?.paragraphs[0]?.runs[0]
    const paragraphs = mainParagraphs(document)
    const trackedParagraphId = document.model.changes.find(
      ({ elementName }) => elementName === 'pPrChange',
    )?.paragraphId
    const tracked = paragraphs.find(({ id }) => id === trackedParagraphId)
    if (!headerRun || !tracked) throw new Error('Fixture model is missing.')

    expect(() =>
      applyDocumentEdits(document, [
        { type: 'replace_run_text', runId: headerRun.id, text: 'No' },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'set_paragraph_style',
          paragraphId: paragraphs[0]?.id ?? '',
          styleId: 'MissingStyle',
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'delete_paragraph', paragraphId: tracked.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))

    const single = await parseSingleParagraphFixture()
    const onlyId = mainParagraphs(single)[0]?.id
    if (!onlyId) throw new Error('Single paragraph is missing.')
    expect(() =>
      applyDocumentEdits(single, [
        { type: 'delete_paragraph', paragraphId: onlyId },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('replaces the only paragraph when an insert lands before the delete', async () => {
    const single = await parseSingleParagraphFixture()
    const onlyId = mainParagraphs(single)[0]?.id
    if (!onlyId) throw new Error('Single paragraph is missing.')

    applyDocumentEdits(single, [
      {
        type: 'insert_paragraph_after',
        paragraphId: onlyId,
        text: 'Typed line',
      },
      { type: 'delete_paragraph', paragraphId: onlyId },
    ])

    expect(mainParagraphs(single)).toMatchObject([
      { runs: [{ text: 'Typed line' }] },
    ])
  })

  it('tracks a zero-run replacement as an insert and a tracked blank deletion', async () => {
    const document = await parseEmptyParagraphFixture()
    const onlyId = mainParagraphs(document)[0]?.id
    if (!onlyId) throw new Error('Empty paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        {
          type: 'insert_paragraph_after',
          paragraphId: onlyId,
          text: 'Typed line',
          styleId: 'Heading1',
        },
        { type: 'delete_paragraph', paragraphId: onlyId },
      ],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )

    const remaining = mainParagraphs(document)
    expect(remaining).toMatchObject([
      { styleId: 'Heading1', runs: [{ text: 'Typed line' }] },
    ])
    expect(remaining.some(({ id }) => id === onlyId)).toBe(false)
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:ins ')
    expect(xml).toContain('<w:del ')
    expect(xml).toContain('Typed line')
  })

  it('tracks a blank-line deletion so rejecting it restores the paragraph', async () => {
    const document = await parseEmptyParagraphFixture()
    const onlyId = mainParagraphs(document)[0]?.id
    if (!onlyId) throw new Error('Empty paragraph is missing.')

    applyDocumentEdits(
      document,
      [{ type: 'delete_paragraph', paragraphId: onlyId }],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const reparsed = await parseDocx(await serialiseDocx(document))
    const deletion = reparsed.model.changes.find(
      ({ kind, author }) => kind === 'delete' && author === 'Review Author',
    )
    if (!deletion) throw new Error('Tracked blank deletion is missing.')

    applyTrackedChangeDecisions(reparsed, [deletion.id], 'reject')
    const restored = mainParagraphs(
      await parseDocx(await serialiseDocx(reparsed)),
    )
    expect(restored).toMatchObject([{ styleId: 'Heading1', runs: [] }])
  })

  it('restores the blank paragraph when a tracked replacement is rejected', async () => {
    const document = await parseEmptyParagraphFixture()
    const onlyId = mainParagraphs(document)[0]?.id
    if (!onlyId) throw new Error('Empty paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        {
          type: 'insert_paragraph_after',
          paragraphId: onlyId,
          text: 'Typed line',
          styleId: 'Heading1',
        },
        { type: 'delete_paragraph', paragraphId: onlyId },
      ],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const reparsed = await parseDocx(await serialiseDocx(document))
    const deletion = reparsed.model.changes.find(
      ({ kind, author }) => kind === 'delete' && author === 'Review Author',
    )
    if (!deletion) throw new Error('Tracked blank deletion is missing.')
    applyTrackedChangeDecisions(reparsed, [deletion.id], 'reject')
    const restored = mainParagraphs(
      await parseDocx(await serialiseDocx(reparsed)),
    )
    expect(
      restored.some(
        (paragraph) =>
          paragraph.styleId === 'Heading1' && paragraph.runs.length === 0,
      ),
    ).toBe(true)
  })

  it('changes only the main story fragment and preserves every other part byte-for-byte', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')
    const tracked = document.sourceParts
      .get('word/document.xml')
      ?.trackedChanges.map(({ sourceFragment, wire }) => ({
        sourceFragment,
        wire,
      }))

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Revised overview' },
    ])
    const output = await serialiseDocx(document)
    const before = await zipParts(input)
    const after = await zipParts(output)

    for (const [name, bytes] of before) {
      if (name === 'word/document.xml') continue
      expect(after.get(name), name).toEqual(bytes)
    }
    const outputXml = decoder.decode(after.get('word/document.xml'))
    expect(outputXml).toContain('w:tag w:val="fixed-control"')
    const reparsed = await parseDocx(output)
    expect(
      reparsed.sourceParts
        .get('word/document.xml')
        ?.trackedChanges.map(({ sourceFragment, wire }) => ({
          sourceFragment,
          wire,
        })),
    ).toEqual(tracked)
  })

  it('leaves invalidated anchors as explicit unresolved orphans', async () => {
    const document = await parseFixture()
    const paragraphs = mainParagraphs(document)
    const unaffected = paragraphs[0]
    const shortened = paragraphs[1]
    const deleted = paragraphs[2]
    if (!unaffected || !shortened || !deleted) {
      throw new Error('Fixture paragraphs are missing.')
    }
    const stableAnchor = {
      paragraphId: unaffected.id,
      startOffset: 0,
      endOffset: 5,
    }
    const shortenedAnchor = {
      paragraphId: shortened.id,
      startOffset: 0,
      endOffset: shortened.runs[0]?.text.length ?? 0,
    }
    const deletedAnchor = {
      paragraphId: deleted.id,
      startOffset: 0,
      endOffset: 1,
    }

    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: shortened.runs[0]?.id ?? '',
        text: 'x',
      },
      { type: 'delete_paragraph', paragraphId: deleted.id },
    ])

    expect(() =>
      validateCommentAnchor(document.model, stableAnchor),
    ).not.toThrow()
    expect(() =>
      validateCommentAnchor(document.model, shortenedAnchor),
    ).toThrowError(
      expect.objectContaining({ code: 'comment-anchor-unresolved' }),
    )
    expect(() =>
      validateCommentAnchor(document.model, deletedAnchor),
    ).toThrowError(
      expect.objectContaining({ code: 'comment-anchor-unresolved' }),
    )
  })
})

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

async function parseSingleParagraphFixture() {
  const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
  const zip = await JSZip.loadAsync(input)
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Only</w:t></w:r></w:p></w:body></w:document>',
  )
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
}

async function parseEmptyParagraphFixture() {
  const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
  const zip = await JSZip.loadAsync(input)
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr></w:p></w:body></w:document>',
  )
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
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

async function zipParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  return new Map(
    await Promise.all(
      Object.values(zip.files)
        .filter((entry) => !entry.dir)
        .map(
          async (entry) =>
            [entry.name, await entry.async('uint8array')] as const,
        ),
    ),
  )
}
