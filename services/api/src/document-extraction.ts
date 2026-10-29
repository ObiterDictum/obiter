import mammoth from 'mammoth'
import { DEFAULT_OOXML_PACKAGE_LIMITS, OoxmlError } from '@obiter/ooxml'
import type { ExtractedDocumentContent } from './document-layout'
import {
  DocumentExtractionError,
  IMAGE_ONLY_DOCX_MESSAGE,
  UNREADABLE_DOCX_MESSAGE,
  type SupportedDocumentType,
} from './document-extraction-limits'
import {
  boundedDocxBuffer,
  extractDocxSupplementalContent,
  readDocxSupplementalContent,
  type DocumentExtractionDependencies,
} from './docx-extraction'
import { extractPdfContent } from './pdf-extraction'

export type { ExtractedDocumentContent } from './document-layout'
export {
  DocumentExtractionError,
  IMAGE_ONLY_DOCX_MESSAGE,
  SCANNED_PDF_MESSAGE,
  UNREADABLE_DOCX_MESSAGE,
  type SupportedDocumentType,
} from './document-extraction-limits'
export type { DocumentExtractionDependencies } from './docx-extraction'
export {
  decodeXmlText,
  extractWordXmlText,
  readDocxNoteBodies,
} from './docx-extraction'
export { prepareLaidChars } from './pdf-extraction'

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

export async function extractDocumentText(
  fileType: SupportedDocumentType,
  buffer: Buffer,
  dependencies: DocumentExtractionDependencies = {},
): Promise<string> {
  return (await extractDocumentContent(fileType, buffer, dependencies)).text
}

export async function extractDocumentContent(
  fileType: SupportedDocumentType,
  buffer: Buffer,
  dependencies: DocumentExtractionDependencies = {},
): Promise<ExtractedDocumentContent> {
  try {
    if (fileType === 'txt')
      return { text: buffer.toString('utf8'), layout: null }
    if (fileType === 'pdf') return await extractPdfContent(buffer)
    const limits = dependencies.ooxmlLimits ?? DEFAULT_OOXML_PACKAGE_LIMITS
    const boundedBuffer = await boundedDocxBuffer(buffer, limits)
    const [result, supplemental] = await Promise.all([
      mammoth.extractRawText({ buffer: boundedBuffer }),
      readDocxSupplementalContent(
        buffer,
        limits,
        dependencies.extractDocxSupplementalContent ??
          extractDocxSupplementalContent,
      ),
    ])
    if (result.messages.length > 0)
      console.warn('Mammoth extraction warnings', {
        count: result.messages.length,
        types: [...new Set(result.messages.map((message) => message.type))],
      })
    const text = [
      ...supplemental.header,
      result.value,
      ...supplemental.footer,
      ...supplemental.notes,
    ]
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
    if (
      error instanceof OoxmlError &&
      error.code === 'package-limits-exceeded'
    ) {
      throw new DocumentExtractionError(error.message, true)
    }
    const message =
      error instanceof Error ? error.message : 'Unknown extraction error.'
    throw new DocumentExtractionError(
      `Document text extraction failed: ${message}`,
    )
  }
}
