import { documentEditOperationSchema } from '@obiter/contracts'
import { describe, expect, it } from 'vitest'

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
})

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}
