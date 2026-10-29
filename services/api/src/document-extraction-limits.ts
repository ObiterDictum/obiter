export type SupportedDocumentType = 'docx' | 'pdf' | 'txt'
export const MAX_EXTRACTED_DOCUMENT_TEXT_LENGTH = 200_000
export const MAX_PDF_PAGE_COUNT = 1_000
export const MINIMUM_PDF_CHARS_PER_PAGE = 20
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
