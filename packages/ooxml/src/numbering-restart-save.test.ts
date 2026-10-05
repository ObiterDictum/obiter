import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import { applyDocumentEdits, parseDocx, serialiseDocx } from './index'
import { parseXmlElements } from './parts/overlay'

const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

describe('numbering restart save round-trip', () => {
  it('keeps a self-closing nested level and reloads the restarted start', async () => {
    const numbering =
      `<w:numbering xmlns:w="${WORD_NAMESPACE}">` +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"/></w:lvlOverride></w:num>' +
      '</w:numbering>'
    const document = await parseFixture(numbering)
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_numbering',
        paragraphId: first.id,
        numId: '1',
        ilvl: 0,
        startOverride: 3,
      },
    ])
    const created = document.model.numbering.find(
      (instance) => instance.startOverride === 3,
    )
    if (!created) throw new Error('created numbering instance is missing.')

    const numberingXml = await zipText(
      await serialiseDocx(document),
      'word/numbering.xml',
    )
    expect(() => parseXmlElements(numberingXml)).not.toThrow()
    // The self-closing level is expanded into a paired redefinition carrying
    // the restarted start, not dropped while the model keeps recording it.
    expect(numFragment(numberingXml, created.numberingId)).toContain(
      '<w:lvl w:ilvl="0"><w:start w:val="3"/></w:lvl>',
    )

    const parsed = await reloadInstance(document, created.numberingId)
    expect(parsed?.levels?.find((level) => level.ilvl === 0)?.start).toBe(3)
    // The reloaded part must describe the same levels as the edit's model
    // entry; a dropped redefinition leaks the abstract formatting back in.
    expect(parsed?.levels).toEqual(created.levels)
  })

  it('rewrites a paired start without leaving a dangling close tag', async () => {
    const numbering =
      `<w:numbering xmlns:w="${WORD_NAMESPACE}">` +
      '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>' +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:start w:val="5"></w:start><w:numFmt w:val="upperLetter"/><w:lvlText w:val="%1)"/></w:lvl></w:lvlOverride></w:num>' +
      '</w:numbering>'
    const document = await parseFixture(numbering)
    const first = mainParagraphs(document)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(document, [
      {
        type: 'set_paragraph_numbering',
        paragraphId: first.id,
        numId: '1',
        ilvl: 0,
        startOverride: 3,
      },
    ])
    const created = document.model.numbering.find(
      (instance) => instance.startOverride === 3,
    )
    if (!created) throw new Error('created numbering instance is missing.')

    const numberingXml = await zipText(
      await serialiseDocx(document),
      'word/numbering.xml',
    )
    // A paired source start must become one self-closing element, so the
    // emitted part is well-formed and cannot carry a stray close tag.
    expect(() => parseXmlElements(numberingXml)).not.toThrow()
    const fragment = numFragment(numberingXml, created.numberingId)
    expect(fragment).not.toContain('</w:start>')
    expect(fragment).toContain('<w:start w:val="3"/>')
    expect(fragment).not.toContain('<w:start w:val="5">')

    const parsed = await reloadInstance(document, created.numberingId)
    expect(parsed?.levels?.find((level) => level.ilvl === 0)?.start).toBe(3)
    expect(parsed?.levels).toEqual(created.levels)
  })
})

async function parseFixture(numbering: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file('word/numbering.xml', numbering)
  return parseDocx(await zip.generateAsync({ type: 'uint8array' }))
}

async function reloadInstance(
  document: Awaited<ReturnType<typeof parseDocx>>,
  numberingId: string,
) {
  const reloaded = await parseDocx(await serialiseDocx(document))
  return reloaded.model.numbering.find(
    (instance) => instance.numberingId === numberingId,
  )
}

function numFragment(xml: string, numberingId: string) {
  const at = xml.indexOf(`<w:num w:numId="${numberingId}">`)
  if (at === -1) throw new Error('created numbering instance is missing.')
  return xml.slice(at, xml.indexOf('</w:num>', at) + 8)
}

async function zipText(input: Uint8Array, partName: string) {
  const zip = await JSZip.loadAsync(input)
  const part = zip.file(partName)
  if (!part) throw new Error(`${partName} is missing.`)
  return part.async('string')
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find((story) => story.kind === 'document')
      ?.paragraphs ?? []
  )
}
