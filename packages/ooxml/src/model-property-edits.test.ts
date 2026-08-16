import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

describe('run emphasis and paragraph numbering edits', () => {
  it('writes bold, italic, and underline without dropping run style', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      {
        type: 'set_run_emphasis',
        runId: run.id,
        bold: true,
        italic: true,
        underline: true,
      },
    ])
    const xml = await storyXml(document)
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )
    const edited = reparsed[1]?.runs[0]?.preservedXmlFragments.join('') ?? ''

    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:i/>')
    expect(xml).toContain('<w:u w:val="single"/>')
    expect(edited).toContain('Heading1Char')
    expect(edited).toContain('<w:b/>')
  })

  it('indents, outdents, and clears list numbering without dropping paragraph style', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_numbering',
        paragraphId: first.id,
        numId: '1',
        ilvl: 1,
      },
    ])
    const indented = await storyXml(document)
    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_numbering',
        paragraphId: first.id,
        numId: null,
      },
    ])
    const cleared = await storyXml(document)

    const firstXml = (xml: string) =>
      xml.match(/<w:p w14:paraId="A1B2C3D4"[\s\S]*?<\/w:p>/u)?.[0] ?? ''

    expect(firstXml(indented)).toContain('<w:ilvl w:val="1"/>')
    expect(firstXml(indented)).toContain('<w:numId w:val="1"/>')
    expect(firstXml(indented)).toContain('<w:pStyle w:val="Heading1"/>')
    expect(firstXml(cleared)).not.toContain('<w:numPr>')
    expect(firstXml(cleared)).toContain('<w:pStyle w:val="Heading1"/>')
  })

  it('rejects empty emphasis and unknown numbering instances before writing', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const first = mainParagraphs(document)[0]
    const run = first?.runs[0]
    if (!first || !run) throw new Error('Fixture model is missing.')

    expect(() =>
      applyDocumentEdits(document, [
        { type: 'set_run_emphasis', runId: run.id },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(() =>
      applyDocumentEdits(document, [
        { type: 'set_run_emphasis', runId: run.id, bold: null },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'set_paragraph_numbering',
          paragraphId: first.id,
          numId: '99',
          ilvl: 0,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('merges style and numbering in one batch into a single pPr for every pPr shape', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const cases: Array<{
      name: string
      bytes: Uint8Array
      paragraphId: string
    }> = []
    const base = await zipText(fixture, 'word/document.xml')
    const plain = mainParagraphs(await parseDocx(fixture)).find((paragraph) =>
      paragraph.preservedXmlFragments.some((fragment) =>
        /<w:pPr\b/u.test(fragment),
      ),
    )
    if (!plain) throw new Error('Fixture paragraph is missing.')
    cases.push({ name: 'rich pPr', bytes: fixture, paragraphId: plain.id })
    cases.push({
      name: 'no pPr',
      bytes: await withDocumentXml(
        fixture,
        base.replace(
          '<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
          '',
        ),
      ),
      paragraphId: plain.id,
    })
    cases.push({
      name: 'self-closing pPr',
      bytes: await withDocumentXml(
        fixture,
        base.replace(
          '<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
          '<w:pPr/>',
        ),
      ),
      paragraphId: plain.id,
    })

    for (const { name, bytes, paragraphId } of cases) {
      for (const tracking of [false, true]) {
        const document = await parseDocx(bytes)
        const paragraph = mainParagraphs(document).find(
          (candidate) => candidate.id === paragraphId,
        )
        if (!paragraph) throw new Error('Paragraph is missing.')
        applyDocumentEdits(
          document,
          [
            {
              type: 'set_paragraph_style',
              paragraphId,
              styleId: 'Base',
            },
            {
              type: 'set_paragraph_numbering',
              paragraphId,
              numId: '1',
              ilvl: 1,
            },
          ],
          tracking
            ? { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' }
            : undefined,
        )
        const xml = await zipText(
          await serialiseDocx(document),
          'word/document.xml',
        )
        const start = xml.indexOf('<w:p w14:paraId="A1B2C3D4"')
        const para = xml.slice(start, xml.indexOf('</w:p>', start) + 6)
        const label = `${name} tracked=${String(tracking)}`
        expect(para, label).toContain('<w:pStyle w:val="Base"/>')
        expect(para, label).toContain('<w:numPr>')
        // never two sibling properties elements
        expect(para, label).not.toContain('</w:pPr><w:pPr>')
        if (tracking) {
          expect(para, label).toMatch(
            /<w:pPrChange[^>]*>[\s\S]*?<\/w:pPrChange>/u,
          )
          const reparsed = await parseDocx(await serialiseDocx(document))
          const edited = mainParagraphs(reparsed).find(
            (candidate) => candidate.id === paragraphId,
          )
          expect(edited?.styleId, label).toBe('Base')
        } else {
          const reparsed = await parseDocx(await serialiseDocx(document))
          const edited = mainParagraphs(reparsed).find(
            (candidate) => candidate.id === paragraphId,
          )
          expect(
            edited?.preservedXmlFragments.filter((fragment) =>
              /<w:pPr\b/u.test(fragment),
            ),
            label,
          ).toHaveLength(1)
          expect(edited?.styleId, label).toBe('Base')
        }
      }
    }
  })

  it('edits the active rPr without touching an existing rPrChange record', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(fixture)
    const run = mainParagraphs(document)
      .flatMap((paragraph) => paragraph.runs)
      .find((candidate) => candidate.text.includes('Tracked formatting'))
    if (!run) throw new Error('Tracked-formatting run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: false },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const rPrs = xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/gu) ?? []
    const edited = rPrs.find((fragment) =>
      fragment.includes('rPrChange w:id="15"'),
    )
    if (!edited) throw new Error('Edited rPr is missing.')
    const active = edited.slice(0, edited.indexOf('<w:rPrChange'))
    const change = edited.slice(edited.indexOf('<w:rPrChange'))
    // toggle-off lands in the active rPr, before the change record
    expect(active).toContain('<w:b w:val="0"/>')
    // the recorded pre-change state is untouched
    expect(change).toContain('<w:b/>')
    expect(change).not.toContain('w:val="0"')
  })

  it('inserts emphasis into the active rPr before an existing rPrChange', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const zip = await JSZip.loadAsync(fixture)
    const base = (await zip.file('word/document.xml')?.async('string')) ?? ''
    zip.file(
      'word/document.xml',
      base.replace(
        '<w:r><w:rPr><w:rPrChange w:id="15"',
        '<w:r><w:rPr><w:rFonts w:ascii="Calibri"/><w:rPrChange w:id="15"',
      ),
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const run = mainParagraphs(document)
      .flatMap((paragraph) => paragraph.runs)
      .find((candidate) => candidate.text.includes('Tracked formatting'))
    if (!run) throw new Error('Tracked-formatting run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const rPrs = xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/gu) ?? []
    const edited = rPrs.find((fragment) =>
      fragment.includes('rPrChange w:id="15"'),
    )
    if (!edited) throw new Error('Edited rPr is missing.')
    const active = edited.slice(0, edited.indexOf('<w:rPrChange'))
    expect(active.indexOf('Calibri')).toBeLessThan(active.indexOf('<w:b/>'))
  })

  it('keeps pStyle first when numbering inserts into a rich pPr', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')
    const story = document.model.stories.find((s) => s.kind === 'document')
    const overlay = document.sourceParts.get(story?.partName ?? '')?.overlay
    const anchor = document.paragraphAnchors.get(first.id)
    if (!overlay || !anchor?.paragraphPropertiesRange) {
      throw new Error('Fixture pPr is missing.')
    }
    const range = anchor.paragraphPropertiesRange
    overlay.source =
      overlay.source.slice(0, range.start) +
      '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' +
      overlay.source.slice(range.end)

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_numbering',
        paragraphId: first.id,
        numId: '1',
        ilvl: 0,
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:p w14:paraId="A1B2C3D4"')
    const para = xml.slice(start, xml.indexOf('</w:p>', start) + 6)
    expect(para.indexOf('<w:pStyle w:val="Heading1"/>')).toBeLessThan(
      para.indexOf('<w:numPr>'),
    )
  })

  it('inserts emphasis after rFonts and before sz in the untracked path', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const base = await zipText(fixture, 'word/document.xml')
    const document = await parseDocx(
      await withDocumentXml(
        fixture,
        base.replace(
          '<w:r><w:t>Alice Example overview</w:t></w:r>',
          '<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr><w:t>Alice Example overview</w:t></w:r>',
        ),
      ),
    )
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:r><w:rPr>')
    const runXml = xml.slice(start, xml.indexOf('</w:r>', start) + 6)
    expect(runXml.indexOf('Calibri')).toBeLessThan(runXml.indexOf('<w:b/>'))
  })

  it('inserts numbering after keepNext in the untracked path', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const base = await zipText(fixture, 'word/document.xml')
    const document = await parseDocx(
      await withDocumentXml(
        fixture,
        base.replace(
          '<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
          '<w:pPr><w:keepNext/></w:pPr>',
        ),
      ),
    )
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_numbering',
        paragraphId: first.id,
        numId: '1',
        ilvl: 0,
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:p w14:paraId="A1B2C3D4"')
    const para = xml.slice(start, xml.indexOf('</w:p>', start) + 6)
    expect(para.indexOf('<w:keepNext/>')).toBeLessThan(
      para.indexOf('<w:numPr>'),
    )
  })

  it('inserts emphasis before sz in the tracked path', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const base = await zipText(fixture, 'word/document.xml')
    const document = await parseDocx(
      await withDocumentXml(
        fixture,
        base.replace(
          '<w:r><w:t>Alice Example overview</w:t></w:r>',
          '<w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>Alice Example overview</w:t></w:r>',
        ),
      ),
    )
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(
      document,
      [{ type: 'set_run_emphasis', runId: run.id, bold: true }],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:r><w:rPr>')
    const runXml = xml.slice(start, xml.indexOf('</w:r>', start) + 6)
    expect(runXml.indexOf('<w:b/>')).toBeLessThan(runXml.indexOf('<w:sz'))
  })

  it('inserts numbering before spacing in the tracked path', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const base = await zipText(fixture, 'word/document.xml')
    const document = await parseDocx(
      await withDocumentXml(
        fixture,
        base.replace(
          '<w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
          '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>',
        ),
      ),
    )
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        {
          type: 'set_paragraph_numbering',
          paragraphId: first.id,
          numId: '1',
          ilvl: 0,
        },
      ],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:p w14:paraId="A1B2C3D4"')
    const para = xml.slice(start, xml.indexOf('</w:p>', start) + 6)
    expect(para.indexOf('<w:numPr>')).toBeLessThan(para.indexOf('<w:spacing'))
  })

  it('keeps rStyle first when emphasis inserts into a rich rPr', async () => {
    const fixture = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const base = await zipText(fixture, 'word/document.xml')
    const document = await parseDocx(
      await withDocumentXml(
        fixture,
        base.replace(
          '<w:r><w:t>Alice Example overview</w:t></w:r>',
          '<w:r><w:rPr><w:rStyle w:val="Heading1Char"/></w:rPr><w:t>Alice Example overview</w:t></w:r>',
        ),
      ),
    )
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:r><w:rPr>')
    const runXml = xml.slice(start, xml.indexOf('</w:r>', start) + 6)
    expect(runXml.indexOf('Heading1Char')).toBeLessThan(
      runXml.indexOf('<w:b/>'),
    )
  })

  it('keeps rStyle first when a tracked style merges after emphasis', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(
      document,
      [
        { type: 'set_run_emphasis', runId: run.id, bold: true },
        { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      ],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const rPrs = xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/gu) ?? []
    const edited = rPrs.find((fragment) => fragment.includes('Heading1Char'))
    if (!edited) throw new Error('Edited rPr is missing.')
    expect(edited.indexOf('Heading1Char')).toBeLessThan(
      edited.indexOf('<w:b/>'),
    )
  })

  it('keeps pStyle before numPr when numbering is written first', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document).find(
      (candidate) =>
        !candidate.preservedXmlFragments.some((fragment) =>
          /<w:pPr\b/u.test(fragment),
        ),
    )
    if (!paragraph) throw new Error('No pPr-less paragraph.')

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_numbering',
        paragraphId: paragraph.id,
        numId: '1',
        ilvl: 0,
      },
      {
        type: 'set_paragraph_style',
        paragraphId: paragraph.id,
        styleId: 'Heading1',
      },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:p>')
    const para = xml.slice(start, xml.indexOf('</w:p>', start) + 6)
    expect(para.indexOf('<w:pStyle w:val="Heading1"/>')).toBeLessThan(
      para.indexOf('<w:numPr>'),
    )
  })

  it('merges run style and emphasis in one batch into a single rPr', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      { type: 'set_run_emphasis', runId: run.id, bold: true },
    ])
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const reparsed = await parseDocx(await serialiseDocx(document))
    const edited = mainParagraphs(reparsed)[1]?.runs[0]
    const rPrs =
      edited?.preservedXmlFragments.filter((fragment) =>
        /<w:rPr\b/u.test(fragment),
      ) ?? []
    expect(rPrs).toHaveLength(1)
    expect(rPrs.join('')).toContain('Heading1Char')
    expect(rPrs.join('')).toContain('<w:b/>')
    expect(xml).toContain('<w:b/>')
  })

  it('merges paragraph style and numbering into one tracked change when tracking', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        { type: 'set_paragraph_style', paragraphId: first.id, styleId: 'Base' },
        {
          type: 'set_paragraph_numbering',
          paragraphId: first.id,
          numId: '1',
          ilvl: 1,
        },
      ],
      { author: 'Review Author', date: '2026-08-12T12:00:00.000Z' },
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const start = xml.indexOf('<w:p w14:paraId="A1B2C3D4"')
    const para = xml.slice(start, xml.indexOf('</w:p>', start) + 6)
    // one outer pPr carrying both edits, one pPr inside the pPrChange
    // holding the original, never two sibling pPr elements
    expect(para).not.toContain('</w:pPr><w:pPr>')
    expect(para.match(/<w:pPrChange/g) ?? []).toHaveLength(1)
    expect(para).toContain('<w:pStyle w:val="Base"/>')
    expect(para).toContain('<w:numPr>')
  })
})

async function zipText(input: Uint8Array, partName: string) {
  const zip = await JSZip.loadAsync(input)
  const part = zip.file(partName)
  if (!part) throw new Error(`${partName} is missing.`)
  return part.async('string')
}

async function withDocumentXml(input: Uint8Array, documentXml: string) {
  const zip = await JSZip.loadAsync(input)
  zip.file('word/document.xml', documentXml)
  return zip.generateAsync({ type: 'uint8array' })
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}

async function storyXml(document: Awaited<ReturnType<typeof parseDocx>>) {
  const zip = await JSZip.loadAsync(await serialiseDocx(document))
  const part = zip.file('word/document.xml')
  if (!part) throw new Error('document.xml is missing.')
  return part.async('string')
}
