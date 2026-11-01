export type SupportedDocumentType = 'docx' | 'pdf' | 'txt'
export const MAX_PDF_PAGE_COUNT = 1_000
const TYPICAL_CHARS_PER_PAGE = 2_000
export const MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH =
  MAX_PDF_PAGE_COUNT * TYPICAL_CHARS_PER_PAGE
export const MINIMUM_PDF_CHARS_PER_PAGE = 20
export const SCANNED_PDF_MESSAGE =
  'This PDF appears to be scanned — text extraction requires OCR, which is not yet supported.'
export const IMAGE_ONLY_DOCX_MESSAGE =
  'This DOCX appears to contain only images — text extraction requires OCR, which is not yet supported.'
export const UNREADABLE_DOCX_MESSAGE =
  'This DOCX could not be read. The file may be corrupt, password-protected, or not a valid Word document.'

function groupedCount(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function documentTextTooLongMessage(length: number) {
  return `This document contains ${groupedCount(length)} characters of text; Redact can process up to ${groupedCount(MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH)} characters (about ${groupedCount(MAX_PDF_PAGE_COUNT)} pages) in one run. Split it into smaller documents and redact each part.`
}

export function extractedTextWithinLimit(text: string) {
  return text.length <= MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH
}

export class DocumentExtractionError extends Error {
  readonly userFacing: boolean

  constructor(message: string, userFacing = false) {
    super(message)
    this.name = 'DocumentExtractionError'
    this.userFacing = userFacing
  }
}
