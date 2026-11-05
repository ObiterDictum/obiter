import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import type { DocumentEditOperation } from '@obiter/contracts'

import {
  applyDocumentEdits,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from './index'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const FIXED_DATE = new Date('2026-08-10T00:00:00.000Z')

type ParsedDocument = Awaited<ReturnType<typeof parseDocx>>

async function pictureDocument(shape: 'inline' | 'anchor' = 'inline') {
  const document = await parseDocx(await createSyntheticDocx(['Body text']))
  const paragraph = mainParagraphs(document)[0]
  if (!paragraph) throw new Error('Fixture model is missing.')
  applyDocumentEdits(document, [
    {
      type: 'insert_image',
      paragraphId: paragraph.id,
      offset: 0,
      contentType: 'image/png',
      dataBase64: PNG_BASE64,
      widthPx: 120,
      heightPx: 80,
      name: 'Figure 1',
    },
  ])
  const bytes = await serialiseDocx(document)
  return parseDocx(shape === 'inline' ? bytes : await floatingDrawing(bytes))
}

async function floatingDrawing(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const part = zip.file('word/document.xml')
  if (!part) throw new Error('Fixture part is missing.')
  const source = await part.async('string')
  const anchor =
    '<wp:anchor simplePos="0" behindDoc="0" allowOverlap="1" layoutInCell="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
  zip.file(
    'word/document.xml',
    source
      .replace(/<wp:inline\b[^>]*>/u, anchor)
      .replace('</wp:inline>', '</wp:anchor>'),
    { date: FIXED_DATE },
  )
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}

function mainParagraphs(document: ParsedDocument) {
  return (
    document.model.stories.find(({ kind }) => kind === 'document')
      ?.paragraphs ?? []
  )
}

function drawingRun(document: ParsedDocument) {
  const run = mainParagraphs(document)
    .flatMap((paragraph) => paragraph.runs)
    .find((candidate) =>
      candidate.preservedXmlFragments.some((fragment) =>
        fragment.includes('<w:drawing'),
      ),
    )
  if (!run) throw new Error('Fixture picture run is missing.')
  return run
}

function drawingXml(document: ParsedDocument) {
  const fragment = drawingRun(document).preservedXmlFragments.find((item) =>
    item.includes('<w:drawing'),
  )
  if (!fragment) throw new Error('Fixture drawing is missing.')
  return fragment
}

async function resize(
  document: ParsedDocument,
  size: { widthPx?: number; heightPx?: number } = {},
) {
  applyDocumentEdits(document, [
    {
      type: 'set_image_size',
      runId: drawingRun(document).id,
      widthPx: size.widthPx ?? 200,
      heightPx: size.heightPx ?? 100,
    },
  ])
  return parseDocx(await serialiseDocx(document))
}

describe('picture size edits', () => {
  it('writes the new size to wp:extent and the matching a:ext in pic:spPr', async () => {
    const saved = await resize(await pictureDocument())
    const xml = drawingXml(saved)
    expect(xml).toContain('<wp:extent cx="1905000" cy="952500"/>')
    expect(xml).toContain('<a:ext cx="1905000" cy="952500"/>')
    expect(xml).not.toContain('cx="1143000"')
  })

  it('leaves the drawing name, relationship, offset and geometry untouched', async () => {
    const before = drawingXml(await pictureDocument())
    const xml = drawingXml(await resize(await pictureDocument()))
    const attribute = (source: string, value: string) =>
      new RegExp(`\\b${value}=("[^"]*")`, 'u').exec(source)?.[1]
    for (const name of ['r:embed', 'name', 'id', 'uri']) {
      expect(attribute(xml, name)).toBe(attribute(before, name))
    }
    expect(xml).toContain('<a:off x="0" y="0"/>')
    expect(xml).toContain('<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>')
    expect(xml).toContain('noChangeAspect="1"')
  })

  it('repaints the run from its preserved drawing before the file is saved', async () => {
    const document = await pictureDocument()
    await resize(document, { widthPx: 60, heightPx: 40 })
    expect(drawingXml(document)).toContain('cx="571500" cy="381000"')
  })

  it('keeps the resized extent through save and reload', async () => {
    const reloaded = await resize(await pictureDocument(), {
      widthPx: 90,
      heightPx: 45,
    })
    expect(drawingXml(reloaded)).toContain('cx="857250" cy="428625"')
    expect(
      mainParagraphs(reloaded).flatMap((paragraph) => paragraph.runs),
    ).toHaveLength(2)
  })

  it('applies two size changes to the same picture in one batch', async () => {
    const document = await pictureDocument()
    const runId = drawingRun(document).id
    applyDocumentEdits(document, [
      { type: 'set_image_size', runId, widthPx: 200, heightPx: 100 },
      { type: 'set_image_size', runId, widthPx: 300, heightPx: 150 },
    ])
    const saved = await parseDocx(await serialiseDocx(document))
    expect(drawingXml(saved)).toContain('cx="2857500" cy="1428750"')
  })

  it('refuses a picture that floats instead of sitting inline', async () => {
    const document = await pictureDocument('anchor')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'set_image_size',
          runId: drawingRun(document).id,
          widthPx: 200,
          heightPx: 100,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })

  it('refuses a run that holds no picture', async () => {
    const document = await pictureDocument()
    const textRun = mainParagraphs(document)
      .flatMap((paragraph) => paragraph.runs)
      .find((run) => run.text.length > 0)
    if (!textRun) throw new Error('Fixture text run is missing.')
    expect(() =>
      applyDocumentEdits(document, [
        {
          type: 'set_image_size',
          runId: textRun.id,
          widthPx: 200,
          heightPx: 100,
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'invalid-document-edit' }))
  })

  it('refuses a picture size change under tracked changes', async () => {
    const document = await pictureDocument()
    expect(() =>
      applyDocumentEdits(
        document,
        [
          {
            type: 'set_image_size',
            runId: drawingRun(document).id,
            widthPx: 200,
            heightPx: 100,
          } satisfies DocumentEditOperation,
        ],
        { author: 'Reviewer', date: '2026-08-12T12:00:00.000Z' },
      ),
    ).toThrowError(expect.objectContaining({ code: 'model-node-not-editable' }))
  })
})
