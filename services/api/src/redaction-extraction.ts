import {
  DEFAULT_OOXML_PACKAGE_LIMITS,
  loadOoxmlZipEntries,
  OoxmlError,
  type OoxmlPackageLimits,
} from '@obiter/ooxml'
import {
  DocumentExtractionError,
  extractDocumentContent,
  type SupportedDocumentType,
} from './document-extraction'
import { mapDocxText } from './redaction-docx-map'
import { prepareDocxForBurn } from './redaction-docx-xml'

const NO_REVIEWABLE_DOCX_TEXT =
  'This Word document has no body, header, footer, note or comment text Redact can review. Save it as PDF and upload the PDF instead.'

/** Redact coordinates belong only to Redact; matter ingestion keeps Mammoth. */
export async function extractRedactionContent(
  fileType: SupportedDocumentType,
  bytes: Buffer,
  dependencies: { ooxmlLimits?: OoxmlPackageLimits } = {},
) {
  if (fileType !== 'docx')
    return extractDocumentContent(fileType, bytes, dependencies)
  try {
    const limits = dependencies.ooxmlLimits ?? DEFAULT_OOXML_PACKAGE_LIMITS
    const prepared = await prepareDocxForBurn(bytes, limits)
    const { text } = mapDocxText(await loadOoxmlZipEntries(prepared, limits))
    if (!text.trim()) {
      // Reuse the curated image-only/unreadable refusal. Never store Mammoth
      // text as Redact coordinates: the burn could not use them.
      await extractDocumentContent(fileType, bytes, dependencies)
      throw new DocumentExtractionError(NO_REVIEWABLE_DOCX_TEXT, true)
    }
    return { text, layout: null }
  } catch (error) {
    if (error instanceof DocumentExtractionError) throw error
    throw new DocumentExtractionError(
      error instanceof OoxmlError && error.code === 'package-limits-exceeded'
        ? error.message
        : 'Document text could not be read for redaction.',
      true,
    )
  }
}
