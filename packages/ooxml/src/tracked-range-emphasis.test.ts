import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import {
  applyDocumentEdits,
  applyTrackedChangeDecisions,
  parseDocx,
  serialiseDocx,
} from './index'

const changeContext = {
  author: 'Review Author',
  date: '2026-08-11T12:30:00.000Z',
}

/**
 * Partial-range formatting under tracking: the covered runs split at the
 * range boundaries, each covered piece's `w:rPr` gains the patch plus a
 * `w:rPrChange` marker holding the piece's own previous properties, and the
 * untouched siblings stay byte-identical. A whole-covered run still goes
 * through the single-run tracked writer.
 */
describe('tracked range emphasis', () => {
  it('splits a bare run at the range and marks the covered piece', async () => {
    const document = await parseDocx(
      await documentWithBody('<w:r><w:t>before middle after</w:t></w:r>'),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 7,
          to: 13,
          bold: true,
        },
      ],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )

    // The covered piece carries the patch and the marker; the previous
    // properties are an empty rPr because the source run had none. The
    // unsplit pieces keep the source `w:t` tag verbatim; the synthetic split
    // tags force xml:space="preserve".
    expect(xml).toContain('<w:t>before </w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">middle</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve"> after</w:t>')
    expect(xml).toMatch(
      /<w:rPr><w:b\/><w:rPrChange w:id="\d+"[^>]*><w:rPr\/><\/w:rPrChange><\/w:rPr>/u,
    )
    // The wire model sees the split pieces too.
    expect(paragraph.runs.map(({ text }) => text)).toEqual([
      'before ',
      'middle',
      ' after',
    ])
    // The emitted part reparses to the same text, pieces included.
    const reparsed = await parseDocx(await serialiseDocx(document))
    expect(mainParagraphs(reparsed)[0]?.runs.map(({ text }) => text)).toEqual([
      'before ',
      'middle',
      ' after',
    ])
    const created = reparsed.model.changes.filter(
      ({ author }) => author === changeContext.author,
    )
    expect(created).toEqual([
      expect.objectContaining({
        elementName: 'rPrChange',
        scope: 'run',
        kind: 'property',
      }),
    ])
  })

  it('records the previous direct properties inside the marker', async () => {
    const document = await parseDocx(
      await documentWithBody(
        '<w:r><w:rPr><w:i/></w:rPr><w:t>styled run text</w:t></w:r>',
      ),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 0,
          to: 6,
          bold: true,
        },
      ],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )

    expect(xml).toMatch(
      /<w:rPr><w:b\/><w:i\/><w:rPrChange w:id="\d+"[^>]*><w:rPr><w:i\/><\/w:rPr><\/w:rPrChange><\/w:rPr><w:t>styled<\/w:t>/u,
    )
    // The untouched sibling keeps the source properties byte-identical.
    expect(xml).toContain(
      '<w:rPr><w:i/></w:rPr><w:t xml:space="preserve"> run text</w:t>',
    )
  })

  it('marks each covered piece of a cross-run range with its own change id', async () => {
    const document = await parseDocx(
      await documentWithBody(
        '<w:r><w:t>first</w:t></w:r><w:r><w:t>second</w:t></w:r>',
      ),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          from: 2,
          to: 8,
          underline: true,
        },
      ],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const ids = [...xml.matchAll(/<w:rPrChange w:id="(\d+)"/gu)].map(
      (match) => match[1],
    )

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(xml).toContain('<w:t>fi</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">rst</w:t>')
    expect(xml).toContain('<w:t>sec</w:t>')
    expect(xml).toContain('<w:t xml:space="preserve">ond</w:t>')
    expect(paragraph.runs.map(({ text }) => text)).toEqual([
      'fi',
      'rst',
      'sec',
      'ond',
    ])
  })

  it('accept keeps the new properties and reject restores the previous ones', async () => {
    const input = await documentWithBody(
      '<w:r><w:rPr><w:i/></w:rPr><w:t>styled run text</w:t></w:r>',
    )
    for (const action of ['accept', 'reject'] as const) {
      const document = await parseDocx(input)
      const paragraph = mainParagraphs(document)[0]
      if (!paragraph) throw new Error('Fixture paragraph is missing.')
      applyDocumentEdits(
        document,
        [
          {
            type: 'set_run_emphasis',
            paragraphId: paragraph.id,
            from: 0,
            to: 6,
            bold: true,
          },
        ],
        changeContext,
      )
      // A decision acts on stored XML, so it runs against the reparsed
      // document — the same surface the API decision route sees.
      const stored = await parseDocx(await serialiseDocx(document))
      const created = stored.model.changes.filter(
        ({ author }) => author === changeContext.author,
      )
      expect(created).toHaveLength(1)
      applyTrackedChangeDecisions(
        stored,
        created.map(({ id }) => id),
        action,
      )
      const xml = await zipText(
        await serialiseDocx(stored),
        'word/document.xml',
      )

      expect(xml).not.toContain('rPrChange')
      if (action === 'accept') {
        expect(xml).toContain('<w:rPr><w:b/><w:i/></w:rPr><w:t>styled</w:t>')
      } else {
        expect(xml).toContain('<w:rPr><w:i/></w:rPr><w:t>styled</w:t>')
        expect(xml).not.toContain('<w:b/>')
      }
      // Either way the split pieces stay; reparsing must round-trip.
      const reparsed = await parseDocx(await serialiseDocx(stored))
      expect(reparsed.model.changes).toHaveLength(0)
      expect(
        mainParagraphs(reparsed)[0]
          ?.runs.map(({ text }) => text)
          .join(''),
      ).toBe('styled run text')
    }
  })

  it('refuses a split point inside a surrogate pair', async () => {
    const document = await parseDocx(
      await documentWithBody('<w:r><w:t>ab😀cd</w:t></w:r>'),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    expect(() =>
      applyDocumentEdits(
        document,
        [
          {
            type: 'set_run_emphasis',
            paragraphId: paragraph.id,
            from: 2,
            to: 3,
            bold: true,
          },
        ],
        changeContext,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('refuses a range covering a run that already carries tracked markup', async () => {
    const document = await parseDocx(
      await documentWithBody(
        '<w:r><w:rPr><w:rPrChange w:id="4"><w:rPr/></w:rPrChange></w:rPr><w:t>text</w:t></w:r>',
      ),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    expect(() =>
      applyDocumentEdits(
        document,
        [
          {
            type: 'set_run_emphasis',
            paragraphId: paragraph.id,
            from: 0,
            to: 4,
            bold: true,
          },
        ],
        changeContext,
      ),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
    expect(
      [...document.sourceParts.values()].every(({ dirty }) => !dirty),
    ).toBe(true)
  })

  it('still formats a range beside tracked markup it does not cover', async () => {
    const document = await parseDocx(
      await documentWithBody(
        '<w:ins w:id="4"><w:r><w:t>added</w:t></w:r></w:ins><w:r><w:t>kept</w:t></w:r>',
      ),
    )
    const paragraph = mainParagraphs(document)[0]
    if (!paragraph) throw new Error('Fixture paragraph is missing.')

    applyDocumentEdits(
      document,
      [
        {
          type: 'set_run_emphasis',
          paragraphId: paragraph.id,
          // The inserted text parses out of the paragraph model, so the
          // stored run's range starts at model offset 0.
          from: 1,
          to: 3,
          bold: true,
        },
      ],
      changeContext,
    )
    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    expect(xml).toContain('<w:ins w:id="4">')
    expect(xml).toContain('<w:rPrChange')
    expect(xml).toContain('<w:t xml:space="preserve">ep</w:t>')
  })
})

async function documentWithBody(paragraphContent: string) {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  zip.file(
    'word/document.xml',
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p>${paragraphContent}</w:p></w:body></w:document>`,
  )
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
