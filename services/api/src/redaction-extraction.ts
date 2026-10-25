import { DEFAULT_OOXML_PACKAGE_LIMITS, loadOoxmlZipEntries, OoxmlError, type OoxmlPackageLimits } from '@obiter/ooxml'
import { DocumentExtractionError, extractDocumentContent, type SupportedDocumentType } from './document-extraction'
import { mapDocxText } from './redaction-docx-map'
import { prepareDocxForBurn } from './redaction-docx-xml'

/** Redact coordinates belong only to Redact; matter ingestion keeps Mammoth. */
export async function extractRedactionContent(fileType: SupportedDocumentType, bytes: Buffer, dependencies: { ooxmlLimits?: OoxmlPackageLimits } = {}) {
  if (fileType !== 'docx') return extractDocumentContent(fileType, bytes, dependencies)
  try {
    const limits = dependencies.ooxmlLimits ?? DEFAULT_OOXML_PACKAGE_LIMITS
    const prepared = await prepareDocxForBurn(bytes)
    const { text } = mapDocxText(await loadOoxmlZipEntries(prepared, limits))
    // Keep the shared image-only/OCR refusal when no reviewable text exists.
    if (!text.trim()) return extractDocumentContent(fileType, bytes, dependencies)
    return { text, layout: null }
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error
    throw new DocumentExtractionError(error instanceof OoxmlError && error.code === 'package-limits-exceeded' ? error.message : 'Document text could not be read for redaction.', true)
  }
}
