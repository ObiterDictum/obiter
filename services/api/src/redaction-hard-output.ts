import type { DocumentTextLayout } from './document-layout'
import { documentTextLayoutSchema } from '@obiter/contracts'
import type {
  Decisions,
  RedactionSpan,
  TokenMap,
} from '@obiter/redaction-policy'
import {
  buildRedactedDocx,
  isDocxMimeOrFilename,
  RedactionDocxBurnError,
} from './redaction-docx-output'
import {
  buildRedactedPdf,
  isPdfMimeOrFilename,
  rasterizePdf,
  redactedPdfFilename,
  RedactionCoverGeometryError,
} from './redaction-pdf-output'
import {
  RedactionRendererError,
  type RedactionRenderer,
} from './redaction-renderer'
import type { RedactionRunRecord } from './redaction-database'
import {
  buildSecurePdfFromText,
  SecurePdfError,
  validateSecurePdf,
} from './redaction-secure-pdf'
import type { StorageService } from './storage'

/**
 * Produce the secure PDF for a hard redaction, or refuse. This is a domain
 * function behind the finalize handler so the route stays a boundary: it owns
 * source-kind dispatch, the DOCX render hop, rasterization and the safety gate
 * that must pass before any artifact is stored or the run is finalized.
 *
 * There is no text fallback here by design. A failure is surfaced so the run
 * stays unfinalized and no share-safe claim is made about a substitute file.
 */

export type HardRedactionFailureCategory =
  | 'container_unavailable'
  | 'pdf_burn_failed'
  | 'docx_burn_failed'
  | 'rasterization_failed'
  | 'renderer_unavailable'
  | 'renderer_timeout'
  | 'renderer_error'
  | 'renderer_invalid_pdf'
  | 'validation_failed'
  | 'text_pdf_failed'
  | 'secure_pdf_failed'

export class HardRedactionOutputError extends Error {
  readonly category: HardRedactionFailureCategory

  constructor(category: HardRedactionFailureCategory, message: string) {
    super(message)
    this.name = 'HardRedactionOutputError'
    this.category = category
  }
}

export interface HardRedactionSource {
  objectKey: string
  mimeType: string
  filename: string
}

export interface BuildHardRedactionPdfInput {
  run: RedactionRunRecord
  /** Extracted source text the span offsets address, unmodified. */
  sourceText: string
  /** `applyRedacted(sourceText, ...)`: accepted regions already removed. */
  redactedText: string
  source: HardRedactionSource | null
  layoutObjectKey: string | null
  storage: StorageService
  renderer: RedactionRenderer | null
  tokenMap: TokenMap
}

export async function buildHardRedactionPdf(
  input: BuildHardRedactionPdfInput,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const spans = input.run.spans
  const decisions = input.run.decisions
  const sourceMimeType = input.run.sourceMimeType ?? input.source?.mimeType
  const isPdf = isPdfMimeOrFilename(input.run.sourceFilename, sourceMimeType)
  const isDocx =
    !isPdf && isDocxMimeOrFilename(input.run.sourceFilename, sourceMimeType)

  let bytes: Uint8Array
  if (isPdf) {
    bytes = await buildSecurePdfFromSourcePdf(input, spans, decisions)
  } else if (isDocx) {
    bytes = await buildSecurePdfFromSourceDocx(input)
  } else {
    bytes = await buildSecurePdfFromText(input.redactedText)
  }

  await validateSecurePdf({ bytes, spans, decisions })
  return { bytes, filename: redactedPdfFilename(input.run.sourceFilename) }
}

async function buildSecurePdfFromSourcePdf(
  input: BuildHardRedactionPdfInput,
  spans: RedactionSpan[],
  decisions: Decisions,
) {
  const { storage, source, layoutObjectKey } = input
  if (!source || !layoutObjectKey || !storage.readBinary)
    throw new HardRedactionOutputError(
      'container_unavailable',
      'The source PDF is not available for a secure redaction.',
    )
  const layout = await readLayout(storage, layoutObjectKey)
  const pdfBytes = await storage.readBinary(source.objectKey)
  try {
    // The PDF path already rasterizes marks into a text-free image per page.
    return await buildRedactedPdf({
      pdfBytes,
      layout,
      text: input.sourceText,
      spans,
      decisions,
      outputMode: 'redacted',
      tokenMap: input.tokenMap,
    })
  } catch (error) {
    // Span-integrity errors are handled by the route before this runs, so any
    // refusal here is a cover or rasterization failure.
    throw new HardRedactionOutputError(
      'pdf_burn_failed',
      error instanceof RedactionCoverGeometryError
        ? 'A redaction could not be placed on the page.'
        : 'The source PDF could not be redacted.',
    )
  }
}

async function buildSecurePdfFromSourceDocx(input: BuildHardRedactionPdfInput) {
  const { storage, source, renderer } = input
  if (!source || !storage.readBinary)
    throw new HardRedactionOutputError(
      'container_unavailable',
      'The source document is not available for a secure redaction.',
    )
  if (!renderer)
    throw new HardRedactionOutputError(
      'renderer_unavailable',
      'The document renderer is not configured.',
    )

  const docxBytes = await storage.readBinary(source.objectKey)
  let redactedDocx: Uint8Array
  try {
    redactedDocx = await buildRedactedDocx({
      docxBytes: Buffer.from(docxBytes),
      text: input.sourceText,
      spans: input.run.spans,
      decisions: input.run.decisions,
      outputMode: 'redacted',
      tokenMap: input.tokenMap,
    })
  } catch (error) {
    if (error instanceof RedactionDocxBurnError)
      throw new HardRedactionOutputError(
        'docx_burn_failed',
        'The Word document could not be redacted safely.',
      )
    throw error
  }

  let intermediate: Uint8Array
  try {
    intermediate = await renderer.renderDocxToPdf(Buffer.from(redactedDocx))
  } catch (error) {
    if (error instanceof RedactionRendererError)
      throw new HardRedactionOutputError(error.failure, error.message)
    throw new HardRedactionOutputError(
      'renderer_error',
      'The document renderer failed.',
    )
  }

  try {
    return await rasterizePdf(Buffer.from(intermediate), undefined)
  } catch {
    throw new HardRedactionOutputError(
      'rasterization_failed',
      'The rendered document could not be rasterized.',
    )
  }
}

async function readLayout(
  storage: StorageService,
  layoutObjectKey: string,
): Promise<DocumentTextLayout> {
  try {
    const parsed = documentTextLayoutSchema.safeParse(
      JSON.parse(await storage.readText(layoutObjectKey)),
    )
    if (parsed.success) return parsed.data
  } catch {
    // Fall through to the empty layout: an accepted span then refuses with a
    // cover-geometry error instead of redacting the wrong bytes.
  }
  return { version: 2, pages: [{ width: 1, height: 1 }], segments: [] }
}

/** Map any thrown value to a stable failure category for logs and audit. */
export function hardRedactionFailureCategory(
  error: unknown,
): HardRedactionFailureCategory {
  if (error instanceof HardRedactionOutputError) return error.category
  if (error instanceof RedactionRendererError) return error.failure
  if (error instanceof SecurePdfError) return 'validation_failed'
  return 'secure_pdf_failed'
}
