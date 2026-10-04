import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import {
  createIsomorphicCanvasFactory,
  extractText,
  getDocumentProxy,
} from 'unpdf'
import JSZip from 'jszip'
import {
  applyRunTextReplacementRange,
  createSyntheticDocx,
  parseDocx,
  serialiseDocx,
} from '@obiter/ooxml'
import { loadRendererAssets } from './assets'
import type { RedactionRendererErrorCode } from './contract'
import { RENDERER_LIMITS } from './limits'
import {
  createDocxRenderer,
  RendererFailure,
  type DocxRenderer,
} from './renderer'

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..')

async function demoFixtureBytes(): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(resolve(REPO_ROOT, 'data/evals/redact/demo-fixture.docx')),
  )
}

/** A synthetic sanitised document: one paragraph that is only a black bar. */
async function blackBarDocx(): Promise<Uint8Array> {
  const document = await parseDocx(await createSyntheticDocx(['[REDACTED]']))
  const story = document.model.stories.find((item) => item.kind === 'document')
  const paragraph = story?.paragraphs[0]
  const anchor = paragraph && document.paragraphAnchors.get(paragraph.id)
  if (!anchor) throw new Error('synthetic document has no paragraph anchor')
  applyRunTextReplacementRange(document, anchor, [
    {
      from: 0,
      to: '[REDACTED]'.length,
      text: '[REDACTED]',
      emphasis: { highlight: 'black', colour: '000000' },
    },
  ])
  return serialiseDocx(document)
}

async function manyParagraphDocx(count: number): Promise<Uint8Array> {
  return createSyntheticDocx(
    Array.from({ length: count }, (_, index) => `Paragraph ${index + 1}`),
  )
}

/** One embedded 1x1 PNG, enough to prove the worker wires package images. */
async function imageDocx(): Promise<Uint8Array> {
  const png = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
    0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8,
    215, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0,
    0, 73, 69, 78, 68, 174, 66, 96, 130,
  ])
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  )
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  )
  zip.file(
    'word/_rels/document.xml.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
  )
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t xml:space="preserve">Figure one </w:t></w:r><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr/></w:body></w:document>',
  )
  zip.file('word/media/image1.png', png, { binary: true })
  return zip.generateAsync({ type: 'uint8array' })
}

async function pdfSummary(pdf: Uint8Array) {
  const document = await PDFDocument.load(pdf)
  const size = document.getPage(0).getSize()
  return {
    pageCount: document.getPageCount(),
    width: size.width,
    height: size.height,
  }
}

/** Longest horizontal run of opaque black pixels on page one. */
async function longestBlackRun(pdf: Uint8Array): Promise<number> {
  const CanvasFactory = await createIsomorphicCanvasFactory(
    () => import('@napi-rs/canvas'),
  )
  const document = await getDocumentProxy(Uint8Array.from(pdf), {
    CanvasFactory,
  })
  try {
    const page = await document.getPage(1)
    const viewport = page.getViewport({ scale: 2 })
    const width = Math.ceil(viewport.width)
    const height = Math.ceil(viewport.height)
    const canvas = createCanvas(width, height)
    const context = canvas.getContext('2d')
    await page.render({
      canvasContext: context as never,
      viewport,
      canvas: canvas as never,
    }).promise
    const { data } = context.getImageData(0, 0, width, height)
    let longest = 0
    for (let y = 0; y < height; y += 1) {
      let run = 0
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4
        const black =
          data[index]! < 30 && data[index + 1]! < 30 && data[index + 2]! < 30
        run = black ? run + 1 : 0
        if (run > longest) longest = run
      }
    }
    return longest
  } finally {
    await document.destroy()
  }
}

async function failureCode<T>(
  work: () => Promise<T>,
): Promise<RedactionRendererErrorCode> {
  try {
    await work()
  } catch (error) {
    if (error instanceof RendererFailure) return error.code
    throw error
  }
  throw new Error('expected the render to fail')
}

async function renderDirCount(baseDir: string) {
  const entries = await readdir(baseDir)
  return entries.filter((entry) => entry.startsWith('render-')).length
}

describe('redaction renderer', () => {
  let baseDir: string
  let renderer: DocxRenderer

  beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'obiter-renderer-success-'))
    renderer = await createDocxRenderer({
      assets: await loadRendererAssets(),
      baseTempDir: baseDir,
    })
  }, 60_000)

  afterAll(async () => {
    await renderer.close()
    await rm(baseDir, { recursive: true, force: true })
  })

  it('renders the synthetic demo fixture to a valid single-page PDF', async () => {
    const pdf = await renderer.render(await demoFixtureBytes())
    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-')
    const summary = await pdfSummary(pdf)
    expect(summary.pageCount).toBe(1)
    expect(Number.isFinite(summary.width)).toBe(true)
    expect(Number.isFinite(summary.height)).toBe(true)
    expect(summary.width).toBeGreaterThan(100)
    expect(summary.height).toBeGreaterThan(100)
  })

  it('paginates a long document across more than one page', async () => {
    const summary = await pdfSummary(
      await renderer.render(await manyParagraphDocx(200)),
    )
    expect(summary.pageCount).toBeGreaterThan(1)
  })

  it('paints black-bar emphasis as an opaque black run', async () => {
    const pdf = await renderer.render(await blackBarDocx())
    const summary = await pdfSummary(pdf)
    expect(summary.pageCount).toBe(1)
    expect(summary.width).toBeGreaterThan(0)
    expect(summary.height).toBeGreaterThan(0)
    expect(await longestBlackRun(pdf)).toBeGreaterThan(30)
  })

  it('renders body, table, header and footer content into the PDF', async () => {
    const bytes = new Uint8Array(
      await readFile(
        resolve(REPO_ROOT, 'data/evals/redact/docx-edge-cases-fixture.docx'),
      ),
    )
    const pdf = await renderer.render(bytes)
    const { text } = await extractText(Uint8Array.from(pdf), {
      mergePages: true,
    })
    expect(text).toContain('Body: Jane Example')
    expect(text).toContain('Table: Sarah Example')
    expect(text).toContain('Header: Alice Example')
    expect(text).toContain('Footer: Bob Example')
  })

  it('embeds a package image in a paragraph that also has text', async () => {
    const pdf = await renderer.render(await imageDocx())
    const document = await PDFDocument.load(pdf)
    const resources = document.getPage(0).node.Resources()
    const images = resources?.lookup(PDFName.of('XObject'), PDFDict)
    expect(images?.keys().length ?? 0).toBeGreaterThan(0)
  })

  it('refuses malformed input with a typed error and no artifact', async () => {
    const code = await failureCode(() =>
      renderer.render(new Uint8Array([1, 2, 3, 4])),
    )
    expect(code).toBe('invalid_docx')
    expect(await renderDirCount(baseDir)).toBe(0)
  })

  it('refuses an aborted render with a typed error and no artifact', async () => {
    const controller = new AbortController()
    controller.abort()
    const docx = await demoFixtureBytes()
    const code = await failureCode(() =>
      renderer.render(docx, controller.signal),
    )
    expect(code).toBe('render_cancelled')
    expect(await renderDirCount(baseDir)).toBe(0)
  })

  it('leaves no per-render temp directory after success', async () => {
    await renderer.render(await demoFixtureBytes())
    expect(await renderDirCount(baseDir)).toBe(0)
  })
})

describe('redaction renderer limits', () => {
  async function withRenderer<T>(
    limits: Partial<typeof RENDERER_LIMITS>,
    work: (renderer: DocxRenderer) => Promise<T>,
  ): Promise<T> {
    const baseDir = await mkdtemp(join(tmpdir(), 'obiter-renderer-limits-'))
    const renderer = await createDocxRenderer({
      assets: await loadRendererAssets(),
      limits: { ...RENDERER_LIMITS, ...limits },
      baseTempDir: baseDir,
    })
    try {
      return await work(renderer)
    } finally {
      await renderer.close()
      await rm(baseDir, { recursive: true, force: true })
    }
  }

  it('refuses input above the byte ceiling', async () => {
    const code = await withRenderer({ maxInputBytes: 100 }, (renderer) =>
      failureCode(() => renderer.render(new Uint8Array(200))),
    )
    expect(code).toBe('input_too_large')
  }, 60_000)

  it('refuses a document above the page ceiling', async () => {
    const code = await withRenderer({ maxPages: 1 }, (renderer) =>
      failureCode(async () => renderer.render(await manyParagraphDocx(200))),
    )
    expect(code).toBe('too_many_pages')
  }, 60_000)

  it('fails a render that exceeds the wall-clock budget', async () => {
    const code = await withRenderer({ renderTimeoutMs: 1 }, (renderer) =>
      failureCode(async () => renderer.render(await manyParagraphDocx(50))),
    )
    expect(code).toBe('render_timeout')
  }, 60_000)
})
