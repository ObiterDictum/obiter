import { posix } from 'node:path'
import JSZip from 'jszip'
import mammoth from 'mammoth'
import { getDocumentProxy } from 'unpdf'

export type SupportedDocumentType = 'docx' | 'pdf' | 'txt'

const MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH = 200_000
const MAX_PDF_PAGE_COUNT = 1_000
const MINIMUM_PDF_CHARS_PER_PAGE = 20
const SCANNED_PDF_MESSAGE =
  'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.'

export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentExtractionError'
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

function normalisePdfPageText(text: string) {
  return text
    .replace(/[\p{Cf}]/gu, '')
    .replace(/\r\n?/g, '\n')
    .replace(
      /(?<![A-Za-z0-9@._%+-])(?:[A-Za-z0-9@._%+-] ){3,}[A-Za-z0-9@._%+-](?![A-Za-z0-9@._%+-])/g,
      (characters) => characters.replaceAll(' ', ''),
    )
    .trim()
}

async function extractPdfText(buffer: Buffer) {
  // unpdf's PDF.js wrapper explicitly sets isEvalSupported: false. This path
  // only calls getTextContent(), so embedded PDF JavaScript is not executed.
  // PDF.js accepts this view without transferring it, so matter uploads can
  // still persist the original Buffer after extraction without a second 25 MB copy.
  const bytes = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength,
  )
  const pdf = await getDocumentProxy(bytes)
  try {
    if (pdf.numPages > MAX_PDF_PAGE_COUNT)
      throw new DocumentExtractionError(
        `PDF documents may contain at most ${MAX_PDF_PAGE_COUNT} pages.`,
      )

    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let text = ''
      for (const item of content.items) {
        if ('str' in item) text += item.str
        if ('hasEOL' in item && item.hasEOL) text += '\n'
      }
      pages.push(normalisePdfPageText(text))
      if (pages.join('\n\n').length > MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH)
        throw new DocumentExtractionError(
          `Extracted text must be at most ${MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH} characters.`,
        )
    }

    const text = pages.join('\n\n')
    const characters = text.replaceAll(/[\s\p{Cf}]/gu, '').length

    // A short one-page text-layer PDF is valid. For multi-page PDFs, fewer than
    // 20 non-whitespace characters per page is treated as scanned-like.
    if (
      characters === 0 ||
      (pages.length > 1 &&
        characters < pages.length * MINIMUM_PDF_CHARS_PER_PAGE)
    )
      throw new DocumentExtractionError(SCANNED_PDF_MESSAGE)

    return text
  } finally {
    await pdf.destroy().catch(() => undefined)
  }
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

async function extractDocxHeaderFooterText(buffer: Buffer) {
  const archive = await JSZip.loadAsync(buffer)
  const document = archive.file('word/document.xml')
  const relationships = archive.file('word/_rels/document.xml.rels')
  if (!document || !relationships) return { header: [], footer: [] }

  const [documentXml, relationshipsXml] = await Promise.all([
    document.async('text'),
    relationships.async('text'),
  ])
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
    if (!file) continue
    const text = extractWordXmlText(await file.async('text'))
    if (!text) continue
    ;(/^word\/header/i.test(name) ? header : footer).push(text)
  }
  return { header, footer }
}

/** Extract plain text only; formatting is intentionally not part of redaction input. */
export async function extractDocumentText(
  fileType: SupportedDocumentType,
  buffer: Buffer,
): Promise<string> {
  try {
    if (fileType === 'txt') return buffer.toString('utf8')
    if (fileType === 'pdf') return await extractPdfText(buffer)
    const [result, headerFooter] = await Promise.all([
      mammoth.extractRawText({ buffer }),
      extractDocxHeaderFooterText(buffer),
    ])
    if (result.messages.length > 0)
      console.warn('Mammoth extraction warnings', {
        count: result.messages.length,
        types: [...new Set(result.messages.map((message) => message.type))],
      })
    return [...headerFooter.header, result.value, ...headerFooter.footer]
      .filter((part) => part.length > 0)
      .join('\n\n')
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error
    const message =
      error instanceof Error ? error.message : 'Unknown extraction error.'
    throw new DocumentExtractionError(
      `Document text extraction failed: ${message}`,
    )
  }
}
