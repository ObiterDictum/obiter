import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { buildOoxmlFixture } from '../fixtures/builder'
import { ooxmlFixtureManifest } from '../fixtures/manifest'
import {
  compareOoxmlPackages,
  createSequentialModelIdAllocator,
  parseDocx,
  replaceTextRunText,
  serialiseDocx,
  type ComparableOoxmlPackage,
  type OoxmlDocument,
} from './index'

const decoder = new TextDecoder()

for (const fixture of ooxmlFixtureManifest) {
  describe(fixture.name, () => {
    it('round-trips every clean part byte-for-byte', async () => {
      const input = await buildOoxmlFixture(fixture.name)
      const document = await parseDocx(input)

      expect(
        [...document.sourceParts.values()].every((part) => !part.dirty),
      ).toBe(true)

      const output = await serialiseDocx(document)
      const inputParts = await readZipParts(input)
      const outputParts = await readZipParts(output)
      expect([...outputParts.keys()].sort()).toEqual(
        [...inputParts.keys()].sort(),
      )
      for (const [partName, bytes] of inputParts) {
        expect(sameBytes(outputParts.get(partName), bytes), partName).toBe(true)
      }
      expect(
        compareOoxmlPackages(
          comparablePackage(document, inputParts),
          comparablePackage(document, outputParts),
        ),
      ).toEqual({ equivalent: true })
    })
  })
}

describe('OOXML fidelity corpus', () => {
  it('enumerates every P1 story and its relationship part', async () => {
    const document = await parseFixture('full-fidelity-with-w14-ids')
    expect(document.model.stories.map(({ kind }) => kind).sort()).toEqual([
      'comments',
      'document',
      'endnotes',
      'footer',
      'footer',
      'footnotes',
      'header',
      'header',
    ])
    for (const name of [
      'document',
      'header1',
      'header2',
      'footer1',
      'footer2',
      'footnotes',
      'endnotes',
      'comments',
    ]) {
      expect(
        document.sourceParts.get(`word/_rels/${name}.xml.rels`)?.role,
      ).toBe('relationships')
    }
    expect(
      document.model.stories.every((story) =>
        story.paragraphs.some((paragraph) =>
          paragraph.runs.some((run) => run.text.length > 0),
        ),
      ),
    ).toBe(true)
    expect(
      document.model.relationships.some(
        ({ sourcePartName }) => sourcePartName === 'word/comments.xml',
      ),
    ).toBe(true)
    expect(document.model.styles).toContainEqual(
      expect.objectContaining({
        styleId: 'Heading1',
        basedOnStyleId: 'Base',
        linkedStyleId: 'Heading1Char',
      }),
    )
    expect(document.model.numbering).toContainEqual(
      expect.objectContaining({ numberingId: '2', startOverride: 1 }),
    )
    expect(document.sourceParts.get('word/media/image1.png')).toMatchObject({
      kind: 'binary',
      role: 'opaque',
    })
  })

  it('keeps all tracked changes opaque with authors and timestamps', async () => {
    const document = await parseFixture('full-fidelity-with-w14-ids')
    const changes =
      document.sourceParts.get('word/document.xml')?.trackedChanges
    expect(changes?.map(({ elementName }) => elementName)).toEqual([
      'ins',
      'del',
      'moveFrom',
      'moveTo',
      'pPrChange',
      'rPrChange',
    ])
    expect(changes?.map(({ author }) => author)).toEqual([
      'Alice Example',
      'Jane Example',
      'Alice Example',
      'Jane Example',
      'Alice Example',
      'Jane Example',
    ])
    expect(changes?.map(({ date }) => date)).toEqual([
      '2026-08-10T10:00:00Z',
      '2026-08-10T10:01:00Z',
      '2026-08-10T10:02:00Z',
      '2026-08-10T10:03:00Z',
      '2026-08-10T10:04:00Z',
      '2026-08-10T10:05:00Z',
    ])
  })

  it('regenerates only the intentionally edited text fragment', async () => {
    const input = await buildOoxmlFixture('full-fidelity-with-w14-ids')
    const document = await parseDocx(input)
    const firstRun = document.model.stories
      .find(({ kind }) => kind === 'document')
      ?.paragraphs.at(0)
      ?.runs.at(0)
    expect(firstRun).toBeDefined()
    if (!firstRun) return

    replaceTextRunText(document, firstRun.id, 'Alice Example revised overview')
    expect(
      [...document.sourceParts.values()]
        .filter(({ dirty }) => dirty)
        .map(({ name }) => name),
    ).toEqual(['word/document.xml'])

    const output = await serialiseDocx(document)
    const inputParts = await readZipParts(input)
    const outputParts = await readZipParts(output)
    expect([...outputParts.keys()].sort()).toEqual(
      [...inputParts.keys()].sort(),
    )
    for (const [partName, bytes] of inputParts) {
      if (partName === 'word/document.xml') continue
      expect(sameBytes(outputParts.get(partName), bytes), partName).toBe(true)
    }

    const originalXml = requiredXml(inputParts, 'word/document.xml')
    const outputXml = requiredXml(outputParts, 'word/document.xml')
    const expectedXml = originalXml.replace(
      'Alice Example overview',
      'Alice Example revised overview',
    )
    expect(outputXml).not.toBe(originalXml)
    expect(
      compareOoxmlPackages(
        new Map([['word/document.xml', { kind: 'xml', xml: expectedXml }]]),
        new Map([['word/document.xml', { kind: 'xml', xml: outputXml }]]),
      ),
    ).toEqual({ equivalent: true })

    const reparsed = await parseDocx(output)
    expect(
      reparsed.sourceParts.get('word/document.xml')?.trackedChanges,
    ).toEqual(document.sourceParts.get('word/document.xml')?.trackedChanges)
    expect(reparsed.model.stories[0]?.paragraphs[0]).toMatchObject({
      sourceParaId: 'A1B2C3D4',
      sourceTextId: '01020304',
    })
  })

  it('passes through w14 ids and keeps derived ids out of OOXML', async () => {
    const withIds = await parseFixture('full-fidelity-with-w14-ids')
    const identifiedParagraph = withIds.model.stories[0]?.paragraphs[0]
    expect(identifiedParagraph).toMatchObject({
      id: 'para-w14-A1B2C3D4',
      sourceParaId: 'A1B2C3D4',
      sourceTextId: '01020304',
    })
    expect(identifiedParagraph?.runs[0]).toMatchObject({
      id: 'text-w14-01020304',
      sourceTextId: '01020304',
    })

    const input = await buildOoxmlFixture('full-fidelity-without-w14-ids')
    const withoutIds = await parseDocx(input, {
      idAllocator: createSequentialModelIdAllocator(40),
    })
    expect(withoutIds.model.stories[0]?.paragraphs[0]?.id).toBe('para-000040')
    expect(withoutIds.model.stories[0]?.paragraphs[0]?.runs[0]?.id).toBe(
      'text-000040',
    )
    const output = await serialiseDocx(withoutIds)
    const documentXml = requiredXml(
      await readZipParts(output),
      'word/document.xml',
    )
    expect(documentXml).not.toMatch(/w14:(?:paraId|textId)=/u)
  })
})

async function parseFixture(name: Parameters<typeof buildOoxmlFixture>[0]) {
  return parseDocx(await buildOoxmlFixture(name))
}

async function readZipParts(bytes: Uint8Array) {
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

function comparablePackage(
  document: OoxmlDocument,
  parts: ReadonlyMap<string, Uint8Array>,
): ComparableOoxmlPackage {
  return new Map(
    [...parts].map(([name, bytes]) => [
      name,
      document.sourceParts.get(name)?.kind === 'xml'
        ? { kind: 'xml', xml: decoder.decode(bytes) }
        : { kind: 'binary', bytes },
    ]),
  )
}

function requiredXml(parts: ReadonlyMap<string, Uint8Array>, name: string) {
  const bytes = parts.get(name)
  if (!bytes) throw new Error('Fixture part is missing')
  return decoder.decode(bytes)
}

function sameBytes(actual: Uint8Array | undefined, expected: Uint8Array) {
  return (
    actual?.length === expected.length &&
    expected.every((value, index) => actual[index] === value)
  )
}
