import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  parseDocx,
  parseModelJson,
  serialiseDocx,
  serialiseModelJson,
} from './index'

const changeContext = {
  author: 'Review & Author',
  date: '2026-08-11T12:30:00.000Z',
}

describe('typed tracked changes', () => {
  it('decodes every change element into the shared model shape', async () => {
    const document = await parseDocx(
      await fixtureWithStoryChanges([
        [
          'word/document.xml',
          '<w:ins w:id="01" custom="keep"><w:r><w:t>insert</w:t><w:unknown/></w:r></w:ins>',
        ],
        [
          'word/header1.xml',
          '<w:del w:id="bad"><w:r><w:delText>delete</w:delText></w:r></w:del>',
        ],
        [
          'word/footer1.xml',
          '<w:moveFrom w:id="7"><w:r><w:delText>from</w:delText></w:r></w:moveFrom>',
        ],
        [
          'word/footnotes.xml',
          '<w:moveTo w:id="7"><w:r><w:t>to</w:t></w:r></w:moveTo>',
        ],
        ['word/endnotes.xml', '<w:pPrChange w:id="8"><w:pPr/></w:pPrChange>'],
        ['word/comments.xml', '<w:rPrChange w:id="9"><w:rPr/></w:rPrChange>'],
      ]),
    )

    const decoded = document.model.changes.filter(
      ({ author }) => author === undefined,
    )
    expect(decoded.map(({ elementName }) => elementName)).toEqual([
      'ins',
      'del',
      'moveFrom',
      'moveTo',
      'pPrChange',
      'rPrChange',
    ])
    expect(decoded).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          storyPartName: 'word/document.xml',
          ooxmlId: '01',
          kind: 'insert',
          text: 'insert',
        }),
        expect.objectContaining({
          storyPartName: 'word/footnotes.xml',
          direction: 'to',
          text: 'to',
        }),
        expect.objectContaining({ scope: 'paragraph', text: '' }),
        expect.objectContaining({ scope: 'run', text: '' }),
      ]),
    )
    const moveFrom = decoded.find(
      ({ elementName }) => elementName === 'moveFrom',
    )
    const moveTo = decoded.find(({ elementName }) => elementName === 'moveTo')
    expect(moveFrom?.storyPartName).toBe('word/footer1.xml')
    expect(moveTo?.storyPartName).toBe('word/footnotes.xml')
    expect(moveFrom?.pairId).toBe(moveTo?.id)
    expect(moveTo?.pairId).toBe(moveFrom?.id)
    expect(parseModelJson(serialiseModelJson(document))).toEqual(document.model)
    const modelJson = JSON.stringify(document.model)
    expect(modelJson).not.toContain('custom=')
    expect(modelJson).not.toContain('w:unknown')

    const ordinaryRun = mainParagraphs(document)[0]?.runs[0]
    if (!ordinaryRun) throw new Error('Ordinary fixture run is missing.')
    applyDocumentEdits(document, [
      {
        type: 'replace_run_text',
        runId: ordinaryRun.id,
        text: 'Ordinary edit',
      },
    ])
    const editedXml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(editedXml).toContain(
      '<w:ins w:id="01" custom="keep"><w:r><w:t>insert</w:t><w:unknown/></w:r></w:ins>',
    )
  })

  it('rejects invalid generated metadata before mutating an overlay', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const run = mainParagraphs(document)[0]?.runs[0]
    if (!run) throw new Error('Fixture run is missing.')

    expect(() =>
      applyDocumentEdits(
        document,
        [{ type: 'replace_run_text', runId: run.id, text: 'Revision' }],
        { author: 'bad\u0000author', date: changeContext.date },
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('records replacement and insertion with deterministic valid metadata', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const paragraph = mainParagraphs(document)[0]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture target is missing.')

    applyDocumentEdits(
      document,
      [
        { type: 'replace_run_text', runId: run.id, text: ' revised & text ' },
        {
          type: 'insert_paragraph_after',
          paragraphId: paragraph.id,
          text: ' inserted ',
        },
      ],
      changeContext,
    )
    const output = await serialiseDocx(document)
    const xml = await zipText(output, 'word/document.xml')
    const reparsed = await parseDocx(output)
    const generated = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )

    expect(
      generated.map(({ elementName, ooxmlId }) => [elementName, ooxmlId]),
    ).toEqual([
      ['del', '0'],
      ['ins', '1'],
      ['ins', '2'],
    ])
    expect(generated.every(({ date }) => date === changeContext.date)).toBe(
      true,
    )
    expect(xml).toContain('w:author="Review &amp; Author"')
    expect(xml).toContain('<w:delText>Alice Example overview</w:delText>')
    expect(xml).toContain(
      '<w:t xml:space="preserve"> revised &amp; text </w:t>',
    )
    expect(xml).toContain('<w:t xml:space="preserve"> inserted </w:t>')
  })

  it('records paragraph deletion and property history without removing source content', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const deletion = await parseDocx(input)
    const first = mainParagraphs(deletion)[0]
    if (!first) throw new Error('Fixture paragraph is missing.')
    applyDocumentEdits(
      deletion,
      [{ type: 'delete_paragraph', paragraphId: first.id }],
      changeContext,
    )
    const deletedXml = await zipText(
      await serialiseDocx(deletion),
      'word/document.xml',
    )
    expect(deletedXml).toContain(
      '<w:delText>Alice Example overview</w:delText>',
    )
    expect(deletedXml).toContain('<w:numPr>')

    const styling = await parseDocx(input)
    const paragraph = mainParagraphs(styling)[1]
    const run = paragraph?.runs[0]
    if (!paragraph || !run) throw new Error('Fixture style target is missing.')
    applyDocumentEdits(
      styling,
      [
        {
          type: 'set_paragraph_style',
          paragraphId: paragraph.id,
          styleId: 'Base',
        },
        { type: 'set_run_style', runId: run.id, styleId: 'Heading1Char' },
      ],
      changeContext,
    )
    const styled = await parseDocx(await serialiseDocx(styling))
    expect(styled.model.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          elementName: 'pPrChange',
          scope: 'paragraph',
        }),
        expect.objectContaining({ elementName: 'rPrChange', scope: 'run' }),
      ]),
    )
  })
})

describe('tracked change decisions', () => {
  it.each([
    ['accept', 'new', false, false],
    ['reject', 'old', false, false],
  ] as const)(
    '%s applies insert, delete, move, and property semantics atomically',
    async (action, expectedStyle, hasDeleted, hasInserted) => {
      const document = await decisionFixture()
      const ids = document.model.changes.map(({ id }) => id)
      applyTrackedChangeDecisions(document, ids, action)
      const xml = await zipText(
        await serialiseDocx(document),
        'word/document.xml',
      )

      expect(xml.includes('<w:ins')).toBe(hasInserted)
      expect(xml.includes('<w:del ')).toBe(hasDeleted)
      expect(xml).not.toContain('moveFrom')
      expect(xml).not.toContain('moveTo')
      expect(xml).not.toContain('PrChange')
      expect(xml).toContain(`<w:pStyle w:val="${expectedStyle}"/>`)
      expect(xml).toContain(
        `<w:rStyle w:val="${expectedStyle === 'new' ? 'newChar' : 'oldChar'}"/>`,
      )
      expect(xml).not.toContain('<w:delText>')
      expect(xml).toContain(action === 'accept' ? 'Inserted' : 'Deleted')
      expect(xml).toContain(action === 'accept' ? 'Moved to' : 'Moved from')
    },
  )

  it('decides a move pair whose nodes are in different story parts', async () => {
    const document = await parseDocx(
      await fixtureWithStoryChanges([
        [
          'word/footer1.xml',
          '<w:moveFrom w:id="7"><w:r><w:delText>from</w:delText></w:r></w:moveFrom>',
        ],
        [
          'word/footnotes.xml',
          '<w:moveTo w:id="7"><w:r><w:t>to</w:t></w:r></w:moveTo>',
        ],
      ]),
    )
    const moveFrom = document.model.changes.find(
      ({ elementName, ooxmlId }) =>
        elementName === 'moveFrom' && ooxmlId === '7',
    )
    if (!moveFrom) throw new Error('Cross-part move is missing.')

    applyTrackedChangeDecisions(document, [moveFrom.id], 'accept')
    const output = await serialiseDocx(document)
    const footer = await zipText(output, 'word/footer1.xml')
    const footnotes = await zipText(output, 'word/footnotes.xml')

    expect(footer).not.toContain('moveFrom')
    expect(footer).not.toContain('>from<')
    expect(footnotes).not.toContain('moveTo')
    expect(footnotes).toContain('<w:t>to</w:t>')
  })

  it('fails closed when a property change is not inside its properties element', async () => {
    const document = await directChildPropertyFixture()
    const change = document.model.changes.find(
      ({ elementName }) => elementName === 'pPrChange',
    )
    if (!change) throw new Error('Direct-child property change is missing.')

    expect(() =>
      applyTrackedChangeDecisions(document, [change.id], 'reject'),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
    expect(mainParagraphs(document)[0]?.runs[0]?.text).toBe(
      'Text that must survive',
    )
  })

  it('fails closed for malformed property history', async () => {
    const document = await parseDocx(
      await replaceDocumentXml(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pPrChange w:id="1"><w:unknown/></w:pPrChange></w:pPr><w:r><w:t>Text</w:t></w:r></w:p></w:body></w:document>',
      ),
    )
    const change = document.model.changes[0]
    if (!change) throw new Error('Malformed change is missing.')

    expect(() =>
      applyTrackedChangeDecisions(document, [change.id], 'reject'),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('fails closed for an orphan move and leaves every part clean', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    const orphan = document.model.changes.find(
      ({ elementName }) => elementName === 'moveFrom',
    )
    const valid = document.model.changes.find(
      ({ elementName }) => elementName === 'ins',
    )
    if (!orphan || !valid) throw new Error('Fixture changes are missing.')

    expect(() =>
      applyTrackedChangeDecisions(document, [valid.id, orphan.id], 'accept'),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-tracked-change-decision' }),
    )
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })
})

async function directChildPropertyFixture() {
  return parseDocx(
    await replaceDocumentXml(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPrChange w:id="1"><w:pPr><w:pStyle w:val="old"/></w:pPr></w:pPrChange><w:r><w:t>Text that must survive</w:t></w:r></w:p></w:body></w:document>',
    ),
  )
}

async function decisionFixture() {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="new"/><w:pPrChange w:id="4"><w:pPr><w:pStyle w:val="old"/></w:pPr></w:pPrChange></w:pPr><w:ins w:id="1"><w:r><w:t>Inserted</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>Deleted</w:delText></w:r></w:del><w:moveFrom w:id="3"><w:r><w:delText>Moved from</w:delText></w:r></w:moveFrom><w:moveTo w:id="3"><w:r><w:t>Moved to</w:t></w:r></w:moveTo><w:r><w:rPr><w:rStyle w:val="newChar"/><w:rPrChange w:id="5"><w:rPr><w:rStyle w:val="oldChar"/></w:rPr></w:rPrChange></w:rPr><w:t>Styled</w:t></w:r></w:p></w:body></w:document>`
  return parseDocx(await replaceDocumentXml(xml))
}

async function fixtureWithStoryChanges(
  changes: readonly (readonly [string, string])[],
) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  for (const [partName, change] of changes) {
    const entry = zip.file(partName)
    if (!entry) throw new Error('Fixture story is missing.')
    const source = await entry.async('string')
    zip.file(partName, source.replace(/(<w:p(?:\s[^>]*)?>)/u, `$1${change}`))
  }
  return zip.generateAsync({ type: 'uint8array' })
}

async function replaceDocumentXml(xml: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file('word/document.xml', xml)
  return zip.generateAsync({ type: 'uint8array' })
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function zipText(bytes: Uint8Array, partName: string) {
  const zip = await JSZip.loadAsync(bytes)
  const entry = zip.file(partName)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}
