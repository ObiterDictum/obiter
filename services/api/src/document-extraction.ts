import { posix } from 'node:path'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { getDocumentProxy } from 'unpdf'
import {
  collapsePdfGlyphSpacingWithLayout,
  layoutFromLaidChars,
  type ExtractedDocumentContent,
  type LaidChar,
} from './document-layout'

export type { DocumentTextLayout, ExtractedDocumentContent } from './document-layout'

export type SupportedDocumentType = 'docx' | 'pdf' | 'txt'

const MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH = 200_000
const MAX_PDF_PAGE_COUNT = 1_000
const MINIMUM_PDF_CHARS_PER_PAGE = 20
export const SCANNED_PDF_MESSAGE =
  'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.'
export const IMAGE_ONLY_DOCX_MESSAGE =
  'This DOCX appears to contain only images — text extraction requires OCR, which is not yet supported.'
export const UNREADABLE_DOCX_MESSAGE =
  'This DOCX could not be read. The file may be corrupt, password-protected, or not a valid Word document.'

export class DocumentExtractionError extends Error {
  /**
   * Whether the message was written for the person uploading the document.
   * Wrapped library failures stay false so their internals are not returned to
   * the client; callers decide what to show in their place.
   */
  readonly userFacing: boolean

  constructor(message: string, userFacing = false) {
    super(message)
    this.name = 'DocumentExtractionError'
    this.userFacing = userFacing
  }
}

export function normaliseFileType(
  fileType: string,
): SupportedDocumentType | null {
  const value = fileType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (
    value === 'docx' ||
    value === '.docx' ||
    value ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx'
  if (value === 'txt' || value === '.txt' || value === 'text/plain')
    return 'txt'
  if (value === 'pdf' || value === '.pdf' || value === 'application/pdf')
    return 'pdf'
  return null
}


async function extractPdfContent(buffer: Buffer): Promise<ExtractedDocumentContent> {
  // Copy before handing bytes to PDF.js — getDocumentProxy may transfer/
  // detach the ArrayBuffer, which would break later writes of the original.
  const bytes = Uint8Array.from(buffer)
  const pdf = await getDocumentProxy(bytes)
  try {
    if (pdf.numPages > MAX_PDF_PAGE_COUNT)
      throw new DocumentExtractionError(
        `PDF documents may contain at most ${MAX_PDF_PAGE_COUNT} pages.`,
        true,
      )

    const pages: Array<{ width: number; height: number }> = []
    const chars: LaidChar[] = []

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      pages.push({ width: viewport.width, height: viewport.height })
      const pageIndex = pageNumber - 1
      const content = await page.getTextContent({
        // Keep runs small so per-glyph x/width stay closer to real advances.
        disableCombineTextItems: true,
      })
      let lastY = 0
      let lastX = 0
      let lastHeight = 12
      let lastAscent = 10
      let lastDescent = 2
      for (const item of content.items) {
        if ('str' in item) {
          pushPdfItemChars(chars, item, pageIndex, content.styles)
          if (item.transform) {
            lastX = item.transform[4] ?? lastX
            lastY = item.transform[5] ?? lastY
          }
          const metrics = pdfItemMetrics(item, content.styles)
          lastHeight = metrics.fontSize
          lastAscent = metrics.ascent
          lastDescent = metrics.descent
        }
        if ('hasEOL' in item && item.hasEOL) {
          chars.push({
            ch: '\n',
            pageIndex,
            x: lastX,
            y: lastY,
            width: 0,
            height: lastHeight,
            ascent: lastAscent,
            descent: lastDescent,
          })
        }
      }
      if (pageNumber < pdf.numPages) {
        chars.push(
          {
            ch: '\n',
            pageIndex,
            x: lastX,
            y: lastY,
            width: 0,
            height: lastHeight,
            ascent: lastAscent,
            descent: lastDescent,
          },
          {
            ch: '\n',
            pageIndex,
            x: lastX,
            y: lastY,
            width: 0,
            height: lastHeight,
            ascent: lastAscent,
            descent: lastDescent,
          },
        )
      }
      if (chars.length > MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH)
        throw new DocumentExtractionError(
          `Extracted text must be at most ${MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH} characters.`,
          true,
        )
    }

    const normalised = collapsePdfGlyphSpacingWithLayout(chars)
    const trimmed = trimLaidChars(normalised)
    const text = trimmed.map((item) => item.ch).join('')
    const characters = text.replaceAll(/[\s\p{Cf}]/gu, '').length

    if (
      characters === 0 ||
      (pages.length > 1 &&
        characters < pages.length * MINIMUM_PDF_CHARS_PER_PAGE)
    )
      throw new DocumentExtractionError(SCANNED_PDF_MESSAGE, true)

    return {
      text,
      layout: layoutFromLaidChars(trimmed, pages),
    }
  } finally {
    await pdf.destroy().catch(() => undefined)
  }
}

function pdfItemMetrics(
  item: {
    transform?: number[]
    height?: number
    fontName?: string
  },
  styles: Record<string, { ascent?: number; descent?: number }> | undefined,
) {
  const transform = item.transform ?? []
  const fromTransform = Math.hypot(transform[2] ?? 0, transform[3] ?? 0)
  const fromHeight =
    typeof item.height === 'number' && item.height > 0 ? item.height : 0
  const fontSize = Math.max(fromTransform, fromHeight) || 12
  const style =
    item.fontName && styles ? styles[item.fontName] : undefined
  const ascentRatio =
    typeof style?.ascent === 'number' && style.ascent > 0 ? style.ascent : 0.8
  const descentRatio =
    typeof style?.descent === 'number' ? Math.abs(style.descent) : 0.2
  return {
    fontSize,
    ascent: fontSize * ascentRatio,
    descent: fontSize * descentRatio,
  }
}

function pushPdfItemChars(
  chars: LaidChar[],
  item: {
    str?: string
    transform?: number[]
    width?: number
    height?: number
    fontName?: string
  },
  pageIndex: number,
  styles: Record<string, { ascent?: number; descent?: number }> | undefined,
) {
  const value = item.str ?? ''
  if (!value) return
  const transform = item.transform ?? []
  const originX = transform[4] ?? 0
  const originY = transform[5] ?? 0
  const { fontSize, ascent, descent } = pdfItemMetrics(item, styles)
  const width = typeof item.width === 'number' ? item.width : 0
  const glyphs = [...value]
  const glyphWidth = glyphs.length > 0 ? width / glyphs.length : 0
  glyphs.forEach((ch, index) => {
    chars.push({
      ch,
      pageIndex,
      x: originX + index * glyphWidth,
      y: originY,
      width: Math.max(glyphWidth, 0.5),
      height: fontSize,
      ascent,
      descent,
    })
  })
}

function trimLaidChars(chars: LaidChar[]) {
  let start = 0
  let end = chars.length
  while (start < end && /\s/u.test(chars[start]!.ch)) start += 1
  while (end > start && /\s/u.test(chars[end - 1]!.ch)) end -= 1
  const sliced = chars.slice(start, end)
  const compact: LaidChar[] = []
  let newlineRun = 0
  for (const item of sliced) {
    if (item.ch === '\n') {
      newlineRun += 1
      if (newlineRun <= 2) compact.push(item)
      continue
    }
    newlineRun = 0
    compact.push(item)
  }
  return compact
}

function decodeXmlText(value: string) {
  return value.replace(
    /&(lt|gt|amp|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity, code: string) => {
      const named = {
        lt: '<',
        gt: '>',
        amp: '&',
        quot: '"',
        apos: "'",
      } as const
      const namedValue = named[code.toLowerCase() as keyof typeof named]
      if (namedValue) return namedValue
      const numeric = code.toLowerCase().startsWith('#x')
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10)
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity
    },
  )
}

function extractWordXmlText(xml: string) {
  const parts: string[] = []
  const tokens =
    /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br)(?:\s[^>]*)?\s*\/\s*>|<\/w:p>/gi
  for (const match of xml.matchAll(tokens)) {
    if (match[1] !== undefined) parts.push(decodeXmlText(match[1]))
    else if (match[0].toLowerCase() === '</w:p>') parts.push('\n')
    else if (match[0].toLowerCase().startsWith('<w:tab')) parts.push('\t')
    else parts.push('\n')
  }
  return parts.join('').trim()
}

function xmlAttribute(tag: string, name: string) {
  return new RegExp(`(?:^|\\s)${name}="([^"]+)"`, 'i').exec(tag)?.[1]
}

function hasDocxVisualContent(xml: string, relationshipsXml: string) {
  return (
    /<w:drawing\b|<pic:pic\b/i.test(xml) ||
    [...relationshipsXml.matchAll(/<Relationship\b[^>]*>/gi)].some((match) =>
      /\/image$/i.test(xmlAttribute(match[0], 'Type') ?? ''),
    )
  )
}

interface DocxSupplementalContent {
  header: string[]
  footer: string[]
  visualContent: 'present' | 'absent' | 'unknown'
}

interface DocumentExtractionDependencies {
  extractDocxSupplementalContent?: (
    buffer: Buffer,
  ) => Promise<DocxSupplementalContent>
}

async function extractDocxHeaderFooterText(
  buffer: Buffer,
): Promise<DocxSupplementalContent> {
  const archive = await JSZip.loadAsync(buffer)
  const document = archive.file('word/document.xml')
  const relationships = archive.file('word/_rels/document.xml.rels')
  if (!document) return { header: [], footer: [], visualContent: 'unknown' }

  const [documentXml, relationshipsXml] = await Promise.all([
    document.async('text'),
    relationships?.async('text') ?? '',
  ])
  let visualContent: DocxSupplementalContent['visualContent'] =
    hasDocxVisualContent(documentXml, relationshipsXml) ? 'present' : 'absent'
  const referencedIds = new Set(
    [...documentXml.matchAll(/<w:(?:header|footer)Reference\b[^>]*>/gi)]
      .map((match) => xmlAttribute(match[0], 'r:id'))
      .filter((id): id is string => id !== undefined),
  )
  const referencedParts = [
    ...relationshipsXml.matchAll(/<Relationship\b[^>]*>/gi),
  ]
    .flatMap((match) => {
      const id = xmlAttribute(match[0], 'Id')
      const target = xmlAttribute(match[0], 'Target')
      if (!id || !target || !referencedIds.has(id)) return []
      const name = target.startsWith('/')
        ? target.slice(1)
        : posix.normalize(posix.join('word', decodeXmlText(target)))
      return /^word\/(?:header|footer)\d+\.xml$/i.test(name) ? [name] : []
    })
    .filter((name, index, names) => names.indexOf(name) === index)

  const header: string[] = []
  const footer: string[] = []
  for (const name of referencedParts) {
    const file = archive.file(name)
    if (!file) {
      if (visualContent === 'absent') visualContent = 'unknown'
      continue
    }
    const relationshipsName = posix.join(
      posix.dirname(name),
      '_rels',
      `${posix.basename(name)}.rels`,
    )
    const relationshipsFile = archive.file(relationshipsName)
    const [partXml, partRelationshipsXml] = await Promise.all([
      file.async('text'),
      relationshipsFile?.async('text') ?? '',
    ])
    if (hasDocxVisualContent(partXml, partRelationshipsXml))
      visualContent = 'present'
    const text = extractWordXmlText(partXml)
    if (!text) continue
    ;(/^word\/header/i.test(name) ? header : footer).push(text)
  }
  return { header, footer, visualContent }
}

async function readDocxSupplementalContent(
  buffer: Buffer,
  extract: NonNullable<
    DocumentExtractionDependencies['extractDocxSupplementalContent']
  >,
) {
  try {
    return await extract(buffer)
  } catch (error) {
    console.warn('DOCX header/footer extraction warning', {
      reason: error instanceof Error ? error.message : 'Unknown archive error.',
    })
    return { header: [], footer: [], visualContent: 'unknown' }
  }
}

/** Extract plain text only; formatting is intentionally not part of redaction input. */
export async function extractDocumentText(
  fileType: SupportedDocumentType,
  buffer: Buffer,
  dependencies: DocumentExtractionDependencies = {},
): Promise<string> {
  return (await extractDocumentContent(fileType, buffer, dependencies)).text
}

/** Extract text plus optional PDF layout geometry for review overlays. */
export async function extractDocumentContent(
  fileType: SupportedDocumentType,
  buffer: Buffer,
  dependencies: DocumentExtractionDependencies = {},
): Promise<ExtractedDocumentContent> {
  try {
    if (fileType === 'txt')
      return { text: buffer.toString('utf8'), layout: null }
    if (fileType === 'pdf') return await extractPdfContent(buffer)
    const [result, supplemental] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      readDocxSupplementalContent(
        buffer,
        dependencies.extractDocxSupplementalContent ??
          extractDocxHeaderFooterText,
      ),
    ])
    if (result.messages.length > 0)
      console.warn('Mammoth extraction warnings', {
        count: result.messages.length,
        types: [...new Set(result.messages.map((message) => message.type))],
      })
    const text = [...supplemental.header, result.value, ...supplemental.footer]
      .filter((part) => part.length > 0)
      .join('\n\n')
    if (text.trim().length === 0) {
      if (supplemental.visualContent === 'absent')
        return { text: '', layout: null }
      throw new DocumentExtractionError(
        supplemental.visualContent === 'present'
          ? IMAGE_ONLY_DOCX_MESSAGE
          : UNREADABLE_DOCX_MESSAGE,
        true,
      )
    }
    return { text, layout: null }
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error
    const message =
      error instanceof Error ? error.message : 'Unknown extraction error.'
    throw new DocumentExtractionError(
      `Document text extraction failed: ${message}`,
    )
  }
}
