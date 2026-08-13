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
})

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
