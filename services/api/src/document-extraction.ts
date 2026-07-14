import mammoth from 'mammoth'

export type SupportedDocumentType = 'docx' | 'txt'

export class DocumentExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentExtractionError'
  }
}

export function normaliseFileType(
  fileType: string,
): SupportedDocumentType | 'pdf' | null {
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

/** Extract plain text only; formatting is intentionally not part of redaction input. */
export async function extractDocumentText(
  fileType: SupportedDocumentType,
  buffer: Buffer,
): Promise<string> {
  try {
    if (fileType === 'txt') return buffer.toString('utf8')
    const result = await mammoth.extractRawText({ buffer })
    if (result.messages.length > 0)
      console.warn('Mammoth extraction warnings', {
        count: result.messages.length,
        types: [...new Set(result.messages.map((message) => message.type))],
      })
    return result.value
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown extraction error.'
    throw new DocumentExtractionError(
      `Document text extraction failed: ${message}`,
    )
  }
}
