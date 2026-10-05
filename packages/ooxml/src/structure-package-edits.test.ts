import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'

import {
  applyDocumentEdits,
  createLineageRecorder,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from './index'
import { OOXML_MAX_ENTRIES } from './package-limits-defaults'
import { createOpaquePart } from './parts/opaque'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/package/2006/relationships'
const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'

const imageOperation = (paragraphId: string, offset: number) =>
  ({
    type: 'insert_image',
    paragraphId,
    offset,
    contentType: 'image/png',
    dataBase64: PNG_BASE64,
    widthPx: 10,
    heightPx: 10,
    name: 'Figure',
  }) as const

describe('effective-text image splices', () => {
  it('composes a mid-run picture into a same-batch text replacement', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    const run = anchor?.runs[0]
    if (!anchor || !run) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'replace_run_text', runId: run.id, text: 'Hello brave world' },
      imageOperation(anchor.id, 6),
    ])
    const output = await serialiseDocx(document)

    // The drawing landed inside the replaced text, between 'Hello ' and
    // 'brave world', and the paragraph reparses with exactly that order.
    const reparsed = mainParagraphs(await parseDocx(output))
    const paragraph = reparsed.find((item) => item.id === anchor.id)
    if (!paragraph) throw new Error('Anchor paragraph is missing.')
    const drawingIndex = paragraph.runs.findIndex((candidate) =>
      candidate.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:drawing'),
      ),
    )
    expect(drawingIndex).toBeGreaterThanOrEqual(0)
    const before = paragraph.runs
      .slice(0, drawingIndex)
      .map((candidate) => candidate.text)
      .join('')
    const after = paragraph.runs
      .slice(drawingIndex + 1)
      .map((candidate) => candidate.text)
      .join('')
    expect(before).toBe('Hello ')
    expect(after).toBe('brave world')
    expect(paragraph.runs.map((candidate) => candidate.text).join('')).toBe(
      'Hello brave world',
    )
  })

  it('still places a picture at an offset a fresh paragraph boundary owns', async () => {
    const document = await parseFixture()
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [imageOperation(anchor.id, 0)])
    const output = await serialiseDocx(document)
    const reparsed = mainParagraphs(await parseDocx(output))
    const paragraph = reparsed.find((item) => item.id === anchor.id)
    expect(
      paragraph?.runs[0]?.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:drawing'),
      ),
    ).toBe(true)
  })
})

describe('final-anchor trailing paragraph wires', () => {
  it('keeps one trailing wire across repeated and interleaved inserts', async () => {
    const document = await parseFixture()
    const last = mainParagraphs(document).at(-1)
    if (!last) throw new Error('Fixture model is missing.')
    const recorder = createLineageRecorder(document.model)

    applyDocumentEdits(
      document,
      [
        { type: 'insert_table', paragraphId: last.id, rows: 1, columns: 1 },
        { type: 'insert_table', paragraphId: last.id, rows: 1, columns: 1 },
        {
          type: 'insert_paragraph_after',
          paragraphId: last.id,
          text: 'Between',
        },
        { type: 'insert_table', paragraphId: last.id, rows: 1, columns: 1 },
      ],
      undefined,
      recorder,
    )

    const wires = mainParagraphs(document)
    const ids = wires.map((paragraph) => paragraph.id)
    // One trailing paragraph: repeated inserts park the same wire, not a copy.
    expect(new Set(ids).size).toBe(ids.length)
    const trailing = wires.at(-1)
    if (!trailing) throw new Error('Trailing wire is missing.')
    expect(recorder.paragraphOrigin.get(trailing)).toMatchObject({
      fromParagraphId: null,
    })

    // Wire order and count match what the serialised document reparses to.
    // Fresh wires without a persisted paraId come back with positional ids,
    // so text — not id — is the comparable sequence for inserted content.
    const reparsed = mainParagraphs(
      await parseDocx(await serialiseDocx(document)),
    )
    expect(reparsed).toHaveLength(wires.length)
    expect(reparsed.map((paragraph) => paragraph.id).length).toBe(
      new Set(reparsed.map((paragraph) => paragraph.id)).size,
    )
    expect(
      reparsed.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(''),
      ),
    ).toEqual(
      wires.map((paragraph) => paragraph.runs.map((run) => run.text).join('')),
    )
  })
})

describe('synthetic paragraph-id allocation', () => {
  it('skips a w14 id spelled under another prefix with single quotes', async () => {
    // The same namespace binding spelled `alias:` and single-quoted is still
    // an allocated id — the allocator resolves attributes by namespace.
    const bytes = await createSyntheticDocx(['Before', 'After'])
    const zip = await JSZip.loadAsync(bytes)
    const source = await requiredPart(zip, 'word/document.xml')
    const patched = source.replace(
      '<w:document ',
      `<w:document xmlns:alias="${WORD_2010_NAMESPACE}" `,
    )
    const anchored = patched.replace(
      '</w:body>',
      `<w:p alias:paraId='E6000001'/><w:p/></w:body>`,
    )
    zip.file('word/document.xml', anchored)
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      { type: 'insert_table', paragraphId: anchor.id, rows: 2, columns: 2 },
    ])
    const anchorWire = mainParagraphs(document).find(
      (paragraph) => paragraph.id === 'para-w14-E6000001',
    )
    expect(anchorWire).toBeDefined()

    const xml = await zipText(
      await serialiseDocx(document),
      'word/document.xml',
    )
    const allocated = [
      ...xml.matchAll(/[A-Za-z_.-]+:paraId\s*=\s*['"]([0-9A-Fa-f]{8})['"]/gu),
    ].map((match) => match[1]?.toUpperCase())
    expect(new Set(allocated).size).toBe(allocated.length)
    expect(allocated.filter((id) => id === 'E6000001')).toHaveLength(1)
  })
})

describe('package limits against the finished archive', () => {
  it('refuses an image whose insertion overflows the entry count', async () => {
    // Pad to the cap, then drop the relationships part so the insertion
    // would create two parts (media plus rels) and cross it.
    const document = await parseDocx(await createSyntheticDocx(['Anchor']))
    const missing = OOXML_MAX_ENTRIES - document.sourceParts.size
    for (let index = 0; index < missing; index += 1) {
      const name = `filler/part-${String(index).padStart(4, '0')}.bin`
      document.sourceParts.set(
        name,
        createOpaquePart(name, 'binary', new Uint8Array(1)),
      )
    }
    document.sourceParts.delete('word/_rels/document.xml.rels')
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    // The relationships part is gone, so the insertion would create two
    // parts (media plus rels) — one more than the reserved check allows.
    expect(() =>
      applyDocumentEdits(document, [imageOperation(anchor.id, 0)]),
    ).toThrowError(
      expect.objectContaining({ code: 'package-limits-exceeded' }),
    )
  })

  it('enforces entry limits on the completed archive at serialise time', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Anchor']))
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    applyDocumentEdits(document, [imageOperation(anchor.id, 0)])
    // A part added outside the insertion guard pushes the finished package
    // over the cap: serialise must refuse rather than publish a package the
    // loader itself would reject.
    const over = OOXML_MAX_ENTRIES + 1 - document.sourceParts.size
    for (let index = 0; index < over; index += 1) {
      const name = `filler/part-${String(index).padStart(4, '0')}.bin`
      document.sourceParts.set(
        name,
        createOpaquePart(name, 'binary', new Uint8Array(1)),
      )
    }
    await expect(serialiseDocx(document)).rejects.toMatchObject({
      code: 'package-limits-exceeded',
    })
  })
})

describe('relationship part serialisation', () => {
  it('emits a relationship child in a prefixed root namespace', async () => {
    const document = await parseDocx(
      await docxWithRels(
        `<pkg:Relationships xmlns:pkg="${RELATIONSHIPS_NAMESPACE}"/>`,
      ),
    )
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [imageOperation(anchor.id, 0)])
    const output = await serialiseDocx(document)
    const rels = await zipText(output, 'word/_rels/document.xml.rels')
    expect(rels).toContain('<pkg:Relationship ')
    expect(rels).toContain('Target="media/image1.png"')

    // The relationship survives a reload: the drawing resolves to the part.
    const reparsed = await parseDocx(output)
    const relationship = reparsed.model.relationships.find(
      (item) => item.target === 'media/image1.png',
    )
    expect(relationship?.id).toBeTruthy()
  })

  it('composes two relationships into a self-closing root', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Anchor']))
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [
      imageOperation(anchor.id, 0),
      imageOperation(anchor.id, 0),
    ])
    const output = await serialiseDocx(document)
    const rels = await zipText(output, 'word/_rels/document.xml.rels')
    expect(
      (rels.match(/<Relationship\b/gu) ?? []).length,
    ).toBeGreaterThanOrEqual(2)
    const reparsed = await parseDocx(output)
    const targets = reparsed.model.relationships
      .filter((item) => item.target.startsWith('media/'))
      .map((item) => item.target)
    expect(targets).toEqual(['media/image1.png', 'media/image2.png'])
  })
})

describe('media content types and raster bytes', () => {
  it('overrides an incompatible declared default for the inserted part', async () => {
    const bytes = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const zip = await JSZip.loadAsync(bytes)
    const contentTypes = await requiredPart(zip, '[Content_Types].xml')
    // The package declares png bytes as octet-stream: a package-level lie the
    // insertion must not propagate onto the new media part.
    const patched = contentTypes.replace(
      /Extension="png" ContentType="[^"]+"/u,
      'Extension="png" ContentType="application/octet-stream"',
    )
    expect(patched).not.toBe(contentTypes)
    zip.file('[Content_Types].xml', patched)
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')

    applyDocumentEdits(document, [imageOperation(anchor.id, 0)])
    const output = await serialiseDocx(document)
    const written = await zipText(output, '[Content_Types].xml')
    expect(written).toContain(
      'Extension="png" ContentType="application/octet-stream"',
    )
    expect(written).toContain(
      'PartName="/word/media/image2.png" ContentType="image/png"',
    )
  })

  it('rejects bytes whose signature disagrees with the declared type', async () => {
    const document = await parseDocx(await createSyntheticDocx(['Anchor']))
    const anchor = mainParagraphs(document)[0]
    if (!anchor) throw new Error('Fixture model is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        { ...imageOperation(anchor.id, 0), contentType: 'image/jpeg' },
      ]),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid-document-edit' }),
    )
  })
})

async function parseFixture() {
  return parseDocx(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
}

function mainParagraphs(document: Awaited<ReturnType<typeof parseDocx>>) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

async function docxWithRels(relsXml: string) {
  const bytes = await createSyntheticDocx(['Anchor text'])
  const zip = await JSZip.loadAsync(bytes)
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?>${relsXml}`,
  )
  return zip.generateAsync({ type: 'uint8array' })
}

async function requiredPart(zip: JSZip, name: string) {
  const entry = zip.file(name)
  if (!entry) throw new Error('Fixture part is missing.')
  return entry.async('string')
}

async function zipText(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  return requiredPart(zip, name)
}
