import { createHash } from 'node:crypto'
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'
import { PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib'
import { extractText } from 'unpdf'
import {
  affectsOutput,
  type Decisions,
  type RedactionSpan,
} from '@obiter/redaction-policy'

const A4_WIDTH_POINTS = 595.28
const A4_HEIGHT_POINTS = 841.89
const RENDER_SCALE = 2
const PAGE_MARGIN_POINTS = 48
const FONT_SIZE_POINTS = 11
const LINE_HEIGHT_POINTS = 15
const REDACTED_MARKER = '[REDACTED]'

export const MAX_SECURE_PDF_PAGES = 2000
export const MAX_SECURE_PDF_PAGE_POINTS = 20_000
export const MAX_SECURE_PDF_BYTES = 200 * 1024 * 1024

export class SecurePdfError extends Error {
  readonly reason: string

  constructor(reason: string, message: string) {
    super(message)
    this.name = 'SecurePdfError'
    this.reason = reason
  }
}

export class SecurePdfValidationError extends SecurePdfError {
  constructor(reason: string, message: string) {
    super(reason, message)
    this.name = 'SecurePdfValidationError'
  }
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

export async function buildSecurePdfFromText(
  text: string,
): Promise<Uint8Array> {
  const scale = RENDER_SCALE
  const pageWidth = Math.round(A4_WIDTH_POINTS * scale)
  const pageHeight = Math.round(A4_HEIGHT_POINTS * scale)
  const margin = Math.round(PAGE_MARGIN_POINTS * scale)
  const fontSize = FONT_SIZE_POINTS * scale
  const lineHeight = LINE_HEIGHT_POINTS * scale
  const maxWidth = pageWidth - margin * 2
  const linesPerPage = Math.max(
    1,
    Math.floor((pageHeight - margin * 2) / lineHeight),
  )

  const measure = createCanvas(1, 1).getContext('2d')
  measure.font = `${fontSize}px sans-serif`
  const lines = wrapText(
    text,
    maxWidth,
    (value) => measure.measureText(value).width,
  )

  const output = await PDFDocument.create()
  const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage))
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const canvas = createCanvas(pageWidth, pageHeight)
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pageWidth, pageHeight)
    context.fillStyle = '#000000'
    context.font = `${fontSize}px sans-serif`
    context.textBaseline = 'alphabetic'
    const pageLines = lines.slice(
      pageIndex * linesPerPage,
      (pageIndex + 1) * linesPerPage,
    )
    pageLines.forEach((line, lineIndex) => {
      const baseline = margin + lineHeight * (lineIndex + 0.8)
      drawLineWithBars(context, line, margin, baseline, fontSize)
    })
    const image = await output.embedPng(canvas.toBuffer('image/png'))
    const page = output.addPage([A4_WIDTH_POINTS, A4_HEIGHT_POINTS])
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: A4_WIDTH_POINTS,
      height: A4_HEIGHT_POINTS,
    })
  }
  output.setTitle('')
  output.setAuthor('')
  output.setSubject('')
  output.setKeywords([])
  output.setProducer('')
  output.setCreator('')
  return output.save()
}

function drawLineWithBars(
  context: SKRSContext2D,
  line: string,
  x: number,
  baseline: number,
  fontSize: number,
) {
  const barWidth = context.measureText(REDACTED_MARKER).width
  let cursor = x
  const parts = line.split(REDACTED_MARKER)
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] ?? ''
    if (part) {
      context.fillText(part, cursor, baseline)
      cursor += context.measureText(part).width
    }
    if (index < parts.length - 1) {
      context.globalAlpha = 1
      context.fillRect(cursor, baseline - fontSize * 0.8, barWidth, fontSize)
      cursor += barWidth
    }
  }
}

function wrapText(
  text: string,
  maxWidth: number,
  measure: (value: string) => number,
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r\n|\r|\n/u))
    lines.push(...wrapParagraph(paragraph, maxWidth, measure))
  return lines.length > 0 ? lines : ['']
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: (value: string) => number,
): string[] {
  if (paragraph.length === 0) return ['']
  const out: string[] = []
  let current = ''
  for (const word of paragraph.split(/(\s+)/u)) {
    if (word === '') continue
    if (current === '') {
      const pieces = breakLongWord(word, maxWidth, measure)
      current = pieces.pop() ?? ''
      out.push(...pieces)
      continue
    }
    const candidate = `${current}${word}`
    if (measure(candidate) <= maxWidth) {
      current = candidate
      continue
    }
    out.push(current)
    const pieces = breakLongWord(word.replace(/^\s+/u, ''), maxWidth, measure)
    current = pieces.pop() ?? ''
    out.push(...pieces)
  }
  if (current) out.push(current)
  return out
}

function breakLongWord(
  word: string,
  maxWidth: number,
  measure: (value: string) => number,
): string[] {
  if (measure(word) <= maxWidth) return [word]
  const pieces: string[] = []
  let current = ''
  for (const char of word) {
    if (current && measure(`${current}${char}`) > maxWidth) {
      pieces.push(current)
      current = char
    } else {
      current += char
    }
  }
  if (current) pieces.push(current)
  return pieces.length > 0 ? pieces : ['']
}

export async function validateSecurePdf(input: {
  bytes: Uint8Array
  spans: RedactionSpan[]
  decisions: Decisions
}): Promise<void> {
  const { bytes } = input
  if (bytes.byteLength === 0)
    throw new SecurePdfValidationError('empty', 'The secure PDF is empty.')
  if (bytes.byteLength > MAX_SECURE_PDF_BYTES)
    throw new SecurePdfValidationError(
      'too_large',
      'The secure PDF exceeds the maximum size.',
    )

  let document: PDFDocument
  try {
    document = await PDFDocument.load(bytes, {
      throwOnInvalidObject: true,
      updateMetadata: false,
    })
  } catch {
    throw new SecurePdfValidationError(
      'malformed',
      'The secure PDF could not be read.',
    )
  }

  const pageCount = document.getPageCount()
  if (pageCount < 1)
    throw new SecurePdfValidationError(
      'no_pages',
      'The secure PDF has no pages.',
    )
  if (pageCount > MAX_SECURE_PDF_PAGES)
    throw new SecurePdfValidationError(
      'too_many_pages',
      'The secure PDF has too many pages.',
    )

  assertNoStructuredContent(document)

  for (const page of document.getPages()) {
    const width = page.getWidth()
    const height = page.getHeight()
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0 ||
      width > MAX_SECURE_PDF_PAGE_POINTS ||
      height > MAX_SECURE_PDF_PAGE_POINTS
    )
      throw new SecurePdfValidationError(
        'page_geometry',
        'The secure PDF has a page with invalid dimensions.',
      )
    const annots = page.node.Annots()
    if (annots instanceof PDFArray && annots.size() > 0)
      throw new SecurePdfValidationError(
        'structured_content',
        'The secure PDF retains annotations.',
      )
    if (page.node.get(PDFName.of('AA')))
      throw new SecurePdfValidationError(
        'structured_content',
        'The secure PDF retains page actions.',
      )
    const resources = page.node.Resources()
    if (!resources)
      throw new SecurePdfValidationError(
        'not_rasterized',
        'A secure PDF page was not rasterized.',
      )
    const fonts = resources.lookupMaybe(PDFName.of('Font'), PDFDict)
    if (fonts && fonts.keys().length > 0)
      throw new SecurePdfValidationError(
        'text_layer',
        'The secure PDF contains a text layer.',
      )
    const xobjects = resources.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjects || xobjects.keys().length === 0)
      throw new SecurePdfValidationError(
        'not_rasterized',
        'A secure PDF page was not rasterized.',
      )
  }

  const extracted = await extractText(Uint8Array.from(bytes), {
    mergePages: true,
  })
  if (extracted.text.trim().length > 0)
    throw new SecurePdfValidationError(
      'text_layer',
      'The secure PDF still exposes selectable text.',
    )

  assertSourceTextAbsent(bytes, input.spans, input.decisions)
}

function assertNoStructuredContent(document: PDFDocument) {
  const catalog = document.catalog
  const deniedCatalogKeys = [
    'AcroForm',
    'Names',
    'StructTreeRoot',
    'MarkInfo',
    'OpenAction',
    'AA',
    'Outlines',
    'PageLabels',
    'Metadata',
    'URI',
    'JavaScript',
    'Perms',
    'OCProperties',
  ]
  for (const key of deniedCatalogKeys)
    if (catalog.get(PDFName.of(key)))
      throw new SecurePdfValidationError(
        'structured_content',
        'The secure PDF retains forms, attachments, metadata or accessibility structure.',
      )
  const names = catalog.lookupMaybe(PDFName.of('Names'), PDFDict)
  if (names?.get(PDFName.of('EmbeddedFiles')))
    throw new SecurePdfValidationError(
      'structured_content',
      'The secure PDF retains embedded files.',
    )
}

function assertSourceTextAbsent(
  bytes: Uint8Array,
  spans: RedactionSpan[],
  decisions: Decisions,
) {
  const accepted = spans.filter((span) => affectsOutput(decisions[span.id]))
  const haystack = Buffer.from(bytes)
  for (const span of accepted) {
    if (span.text.length < 4) continue
    if (haystack.includes(Buffer.from(span.text, 'utf8')))
      throw new SecurePdfValidationError(
        'source_text_survives',
        'The secure PDF still contains accepted source text.',
      )
  }
}

export { sha256 }
