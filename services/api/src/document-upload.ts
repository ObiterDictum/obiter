import { Buffer } from 'node:buffer'
import {
  normaliseFileType,
  type SupportedDocumentType,
} from './document-extraction'

/** Bounds buffering and DOCX parsing for authenticated uploads. */
export const MAX_DOCUMENT_UPLOAD_BYTES = 25 * 1024 * 1024

export class DocumentUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentUploadError'
  }
}

function verifiedType(
  filename: string,
  contents: Buffer,
): SupportedDocumentType | null {
  const extension = filename.toLowerCase().split('.').pop()
  const isZip = contents.subarray(0, 2).equals(Buffer.from('PK'))
  if (extension === 'docx' && isZip) return 'docx'
  if (extension === 'txt' && !isZip) return 'txt'
  return null
}

export async function readDocumentUpload(
  file: File,
  declaredType: string,
): Promise<{
  filename: string
  fileType: SupportedDocumentType
  contents: Buffer
}> {
  const supportedType = normaliseFileType(declaredType)
  if (supportedType === 'pdf')
    throw new DocumentUploadError(
      'PDF files are not yet supported for redaction. Please upload DOCX or TXT files.',
    )
  if (!supportedType)
    throw new DocumentUploadError(
      'Only DOCX and TXT files are supported for redaction.',
    )
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES)
    throw new DocumentUploadError(
      `Document uploads must be at most ${MAX_DOCUMENT_UPLOAD_BYTES / 1024 / 1024} MB.`,
    )

  const contents = Buffer.from(await file.arrayBuffer())
  const fileType = verifiedType(file.name, contents)
  if (!fileType || fileType !== supportedType)
    throw new DocumentUploadError(
      'The filename, declared type, and file content must agree.',
    )
  return { filename: file.name, fileType, contents }
}
