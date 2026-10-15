import { documentEditOperationSchema } from '@obiter/contracts'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'

describe('run and paragraph property families', () => {
  it('round-trips run colour, font, and strikethrough through apply and reload', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      documentEditOperationSchema.parse({
        type: 'set_run_emphasis',
        runId: run.id,
        fontFamily: 'Times New Roman',
        fontSize: 28,
        colour: 'C00000',
        highlight: 'yellow',
        strikethrough: true,
        vertAlign: 'superscript',
        smallCaps: true,
      }),
    ])
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )[1]?.runs[0]?.preservedXmlFragments.join('')

    expect(reparsed).toContain('Times New Roman')
    expect(reparsed).toContain('w:val="28"')
    expect(reparsed).toContain('C00000')
    expect(reparsed).toContain('yellow')
    expect(reparsed).toMatch(/<w:strike\b/)
    expect(reparsed).toContain('superscript')
    expect(reparsed).toMatch(/<w:smallCaps\b/)
  })

  it('clears every direct run property through apply, serialise and reload', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    // Write the whole family first, then release it, so the removed elements
    // are ones the writer had just produced rather than absent by accident.
    applyDocumentEdits(document, [
      documentEditOperationSchema.parse({
        type: 'set_run_emphasis',
        runId: run.id,
        bold: true,
        italic: true,
        underline: true,
        fontFamily: 'Times New Roman',
        fontSize: 28,
        colour: 'C00000',
        highlight: 'yellow',
        strikethrough: true,
        vertAlign: 'superscript',
        smallCaps: true,
      }),
    ])
    const written = await parseDocx(await serialiseDocx(document))
    const writtenRun = mainParagraphs(written)[1]?.runs[0]
    if (!writtenRun) throw new Error('Written run is missing.')
    expect(writtenRun.preservedXmlFragments.join('')).toContain(
      'Times New Roman',
    )

    applyDocumentEdits(written, [
      documentEditOperationSchema.parse({
        type: 'set_run_emphasis',
        runId: writtenRun.id,
        bold: null,
        italic: null,
        underline: null,
        fontFamily: null,
        fontSize: null,
        colour: null,
        highlight: null,
        strikethrough: null,
        vertAlign: null,
        smallCaps: null,
      }),
    ])
    const reparsed =
      mainParagraphs(await parseDocx(await serialiseDocx(written)))[1]
        ?.runs.map((item) => item.preservedXmlFragments.join(''))
        .join('') ?? ''

    for (const element of [
      'w:b',
      'w:i',
      'w:u',
      'w:strike',
      'w:highlight',
      'w:vertAlign',
      'w:rFonts',
      'w:sz',
      'w:szCs',
      'w:color',
      'w:smallCaps',
    ]) {
      expect(reparsed).not.toMatch(new RegExp(`<${element}\\b`, 'u'))
    }
  })

  it('round-trips paragraph alignment, spacing, and indent through apply and reload', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      documentEditOperationSchema.parse({
        type: 'set_paragraph_format',
        paragraphId: paragraph.id,
        alignment: 'center',
        lineSpacing: { line: 360, lineRule: 'auto' },
        spaceBefore: 240,
        spaceAfter: 120,
        indentation: { left: 720, firstLine: 360 },
      }),
    ])
    const xml = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )[0]?.preservedXmlFragments.join('')

    expect(xml).toContain('w:val="center"')
    expect(xml).toContain('w:line="360"')
    expect(xml).toContain('w:before="240"')
    expect(xml).toContain('w:after="120"')
    expect(xml).toContain('w:left="720"')
    expect(xml).toContain('w:firstLine="360"')
  })

  it('replays a stored pre-change set_run_emphasis bold op after apply and reload', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[1]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    applyDocumentEdits(document, [
      { type: 'set_run_emphasis', runId: run.id, bold: true },
    ])
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )[1]?.runs[0]?.preservedXmlFragments.join('')

    expect(reparsed).toContain('<w:b/>')
  })

  it('round-trips insert_paragraph_after run fontFamily, colour, and strikethrough', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      documentEditOperationSchema.parse({
        type: 'insert_paragraph_after',
        paragraphId: paragraph.id,
        runs: [
          {
            text: 'Formatted',
            fontFamily: 'Arial',
            colour: 'FF0000',
            strikethrough: true,
          },
        ],
      }),
    ])
    const fragments =
      mainParagraphs(
        await parseDocx(await serialiseDocx(document)),
      )[1]?.runs[0]?.preservedXmlFragments.join('') ?? ''

    expect(fragments).toContain('Arial')
    expect(fragments).toContain('FF0000')
    expect(fragments).toMatch(/<w:strike\b/)
  })

  it('writes alignment and spaceBefore on insert_paragraph_after', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      documentEditOperationSchema.parse({
        type: 'insert_paragraph_after',
        paragraphId: paragraph.id,
        text: 'Aligned paragraph',
        alignment: 'right',
        spaceBefore: 240,
      }),
    ])
    const xml =
      mainParagraphs(
        await parseDocx(await serialiseDocx(document)),
      )[1]?.preservedXmlFragments.join('') ?? ''

    expect(xml).toContain('w:val="right"')
    expect(xml).toContain('w:before="240"')
  })

  it('round-trips a partial range highlight, strikethrough and vertical align', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')
    const text = paragraph.runs.map((run) => run.text).join('')
    if (text.length < 3) throw new Error('Fixture paragraph is too short.')

    applyDocumentEdits(document, [
      documentEditOperationSchema.parse({
        type: 'set_run_emphasis',
        paragraphId: paragraph.id,
        from: 1,
        to: 3,
        highlight: 'yellow',
        strikethrough: true,
        vertAlign: 'subscript',
      }),
    ])
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )[0]
    const runs = reparsed?.runs ?? []
    const covered = runs.filter((run) =>
      run.preservedXmlFragments.join('').includes('yellow'),
    )
    expect(runs.length).toBeGreaterThan(1)
    expect(covered).toHaveLength(1)
    const xml = covered[0]?.preservedXmlFragments.join('') ?? ''
    expect(xml).toMatch(/<w:strike\b/)
    expect(xml).toContain('<w:highlight w:val="yellow"/>')
    expect(xml).toContain('<w:vertAlign w:val="subscript"/>')
  })
})

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}
