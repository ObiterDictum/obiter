import {
  DEFAULT_API_REQUEST_LIMITS,
  type ApiRequestLimits,
} from '../request-limits'
import { Hono } from 'hono'
import type { Pool } from 'pg'
import {
  documentTextLayoutSchema,
  redactionFinalizeInputSchema,
  spanDecisionSchema,
} from '@obiter/contracts'
import {
  applyPseudonymised,
  applyRedacted,
  createTokenMap,
  mixedTextGroups,
  RedactionSpanIntegrityError,
  type OutputDowngradeReason,
} from '@obiter/redaction-policy'
import { appendAuditLog } from '../database'
import { createDocumentMediaResponse } from '../document-media-response'
import {
  downloadContentDisposition,
  safeDownloadFilename,
} from '../download-filename'
import { findUncoveredRegions } from '../extraction-coverage'
import {
  buildHardRedactionPdf,
  hardRedactionFailureCategory,
  HardRedactionOutputError,
  type HardRedactionFailureCategory,
} from '../redaction-hard-output'
import type { RedactionRenderer } from '../redaction-renderer'
import { sha256 } from '../redaction-secure-pdf'
import {
  finalizeRedactionRun,
  withDecisionNames,
  getRedactionOutputKey,
  getRedactionRun,
  getRunLayoutObjectKey,
  getRunSourceFile,
  getRunTextObjectKey,
  publicRun,
  recordSpanDecision,
  type RedactionRunRecord,
} from '../redaction-database'
import {
  redactedPdfFilename,
  redactedTextFilename,
} from '../redaction-pdf-output'
import {
  buildRedactedDocx,
  isDocxMimeOrFilename,
  redactedDocxFilename,
} from '../redaction-docx-output'
import type { StorageService } from '../storage'
import {
  errorResponse,
  jsonBody,
  requireUser,
  type RouteContext,
  type RouteVariables,
} from './redact-shared'

const REDACTION_SOURCE_RESPONSE_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
])

function redactionSourceResponseContentType(storedMimeType: string): string {
  const value = storedMimeType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return REDACTION_SOURCE_RESPONSE_TYPES.has(value)
    ? value
    : 'application/octet-stream'
}

function burnFallbackReason(error: unknown): OutputDowngradeReason {
  const message = error instanceof Error ? error.message : ''
  if (message.includes('tracked change')) return 'tracked_change'
  if (message.includes('survives in')) return 'residual_text'
  return 'burn_failed'
}

async function reportSecurePdfFailure(
  c: RouteContext,
  pool: Pool,
  input: {
    runId: string
    organisationId: string
    userId: string
    outputMode: 'redacted' | 'pseudonymised'
    error: unknown
  },
) {
  const category: HardRedactionFailureCategory = hardRedactionFailureCategory(
    input.error,
  )
  console.error('redaction_secure_pdf_failed', {
    requestId: c.get('requestId'),
    runId: input.runId,
    outputMode: input.outputMode,
    category,
  })
  try {
    await appendAuditLog(pool, {
      organisationId: input.organisationId,
      userId: input.userId,
      entityType: 'redaction_run',
      entityId: input.runId,
      action: 'redaction.finalize_failed',
      metadata: { outputMode: input.outputMode, failureCategory: category },
      requestId: c.get('requestId'),
    })
  } catch {
    console.error('redaction_finalize_failed_audit_unavailable', {
      requestId: c.get('requestId'),
      runId: input.runId,
    })
  }
  return errorResponse(
    c,
    'redaction_secure_pdf_failed',
    securePdfFailureMessage(category),
    category === 'renderer_at_capacity' || category === 'renderer_not_ready'
      ? 503
      : 502,
  )
}

function securePdfFailureMessage(category: HardRedactionFailureCategory) {
  switch (category) {
    case 'renderer_at_capacity':
      return 'The secure PDF could not be produced because the document renderer is busy. Try again shortly; this run was not finalized.'
    case 'renderer_not_ready':
      return 'The secure PDF could not be produced because the document renderer is starting. Try again shortly; this run was not finalized.'
    case 'renderer_input_too_large':
    case 'renderer_too_many_pages':
    case 'renderer_too_large':
      return 'The source document is too large for the secure PDF renderer, so no secure PDF was produced. This run was not finalized.'
    case 'renderer_unavailable':
    case 'renderer_timeout':
    case 'renderer_error':
    case 'renderer_invalid_pdf':
      return 'The secure PDF could not be produced because the document renderer is unavailable. This run was not finalized and no file was shared.'
    case 'docx_burn_failed':
      return 'The Word document could not be redacted safely, so no secure PDF was produced. This run was not finalized.'
    case 'pdf_burn_failed':
      return 'A redaction could not be placed on the page, so no secure PDF was produced. This run was not finalized.'
    case 'validation_failed':
      return 'The secure PDF failed its safety checks and was discarded. This run was not finalized.'
    default:
      return 'No secure PDF was produced, so this run was not finalized. Nothing was downloaded or shared.'
  }
}

type FinalizedRun = RedactionRunRecord

function outputMimeTypeOf(run: FinalizedRun) {
  return run.summary.outputMimeType ?? 'text/plain'
}

function outputFilenameOf(mimeType: string) {
  return mimeType === 'application/pdf'
    ? redactedPdfFilename('document')
    : mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ? redactedDocxFilename('document')
      : redactedTextFilename('document')
}

function isSecurePdfOutput(run: FinalizedRun, mimeType: string) {
  if (mimeType !== 'application/pdf') return false
  if (run.summary.outputMode === 'pseudonymised') return false
  return run.summary.securePdf === true || run.summary.outputMode === 'redacted'
}

function isBinaryOutput(mimeType: string) {
  return (
    mimeType === 'application/pdf' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
}

export function createRedactReviewRoutes(
  pool: Pool,
  storage: StorageService,
  renderer: RedactionRenderer | null = null,
  limits: ApiRequestLimits = DEFAULT_API_REQUEST_LIMITS,
) {
  async function namedReviewers(pool: Pool, run: RedactionRunRecord) {
    return {
      ...run,
      decisions: await withDecisionNames(
        pool,
        run.organisationId,
        run.decisions,
      ),
    }
  }

  const routes = new Hono<{ Variables: RouteVariables }>()

  routes.get('/api/redaction-runs/:runId', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'view')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    return c.json({ run: publicRun(await namedReviewers(pool, run)) })
  })

  routes.get('/api/redaction-runs/:runId/document-text', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'view')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    const textObjectKey = await getRunTextObjectKey(pool, run, user)
    if (!textObjectKey)
      return errorResponse(
        c,
        'document_version_not_found',
        'Document text is not available for this run.',
        404,
      )
    return c.json({ text: await storage.readText(textObjectKey) })
  })

  routes.get('/api/redaction-runs/:runId/source-file', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'view')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    const source = await getRunSourceFile(pool, run, user)
    if (!source || !storage.readBinary)
      return errorResponse(
        c,
        'document_version_not_found',
        'Source file is not available for this run.',
        404,
      )
    const bytes = await storage.readBinary(source.objectKey)
    return createDocumentMediaResponse(
      Uint8Array.from(bytes),
      redactionSourceResponseContentType(source.mimeType),
      source.filename,
    )
  })

  routes.get('/api/redaction-runs/:runId/layout', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'view')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    const layoutObjectKey = await getRunLayoutObjectKey(pool, run, user)
    if (!layoutObjectKey)
      return errorResponse(
        c,
        'document_version_not_found',
        'Layout is not available for this run.',
        404,
      )
    let storedLayout: unknown
    try {
      storedLayout = JSON.parse(await storage.readText(layoutObjectKey))
    } catch {
      console.warn('Stored document layout could not be read or parsed', {
        runId: run.id,
      })
      return errorResponse(
        c,
        'document_version_not_found',
        'Layout is not available for this run.',
        404,
      )
    }
    const layout = documentTextLayoutSchema.safeParse(storedLayout)
    if (!layout.success) {
      console.warn('Stored document layout validation failed', {
        runId: run.id,
        issues: layout.error.issues.map((issue) => ({
          code: issue.code,
          path: issue.path,
        })),
      })
      return errorResponse(
        c,
        'document_version_not_found',
        'Layout is not available for this run.',
        404,
      )
    }
    return c.json({ layout: layout.data })
  })

  routes.post(
    '/api/redaction-runs/:runId/spans/:spanId/decision',
    async (c) => {
      const user = await requireUser(c, pool)
      if (user instanceof Response) return user
      const body = await jsonBody(c)
      if (body instanceof Response) return body
      const decision = spanDecisionSchema.safeParse(body?.decision)
      if (!decision.success)
        return errorResponse(
          c,
          'validation_failed',
          'A valid span decision is required.',
          400,
        )
      const result = await recordSpanDecision({
        pool,
        organisationId: user.organisationId,
        runId: c.req.param('runId'),
        spanId: c.req.param('spanId'),
        decision: decision.data,
        userId: user.id,
        applyToSameText: body?.applyToSameText === true,
      })
      if (result.kind === 'not_found')
        return errorResponse(
          c,
          'redaction_run_not_found',
          'Redaction run not found.',
          404,
        )
      if (result.kind === 'span_not_found')
        return errorResponse(
          c,
          'span_not_found',
          'Span not found in this redaction run.',
          404,
        )
      if (result.kind === 'finalized')
        return errorResponse(
          c,
          'redaction_already_finalized',
          'Finalized redaction runs cannot be changed.',
          409,
        )
      if (result.kind === 'replaced')
        return errorResponse(
          c,
          'conflict_detected',
          `This run was replaced by ${result.replacementRunId} and can no longer be changed.`,
          409,
        )
      if (result.kind === 'not_reviewable')
        return errorResponse(
          c,
          'redaction_run_not_reviewable',
          'This run is not ready for review.',
          400,
        )
      await appendAuditLog(pool, {
        organisationId: user.organisationId,
        userId: user.id,
        entityType: 'redaction_run',
        entityId: result.run.id,
        action: 'redaction.span_decision',
        metadata: {
          spanId: result.span.id,
          spanIds: result.spanIds,
          decision: decision.data,
          category: result.span.category,
        },
        requestId: c.get('requestId'),
      })
      return c.json({
        run: publicRun(await namedReviewers(pool, result.run)),
      })
    },
  )

  routes.post('/api/redaction-runs/:runId/finalize', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const rawBody = await jsonBody(c)
    if (rawBody instanceof Response) return rawBody
    const body = redactionFinalizeInputSchema.safeParse(rawBody)
    if (!body.success)
      return errorResponse(
        c,
        'validation_failed',
        'A valid output mode and acknowledgement value are required.',
        400,
      )
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'edit')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (run.status === 'finalized')
      return errorResponse(
        c,
        'redaction_already_finalized',
        'This run has already been finalized.',
        409,
      )
    if (run.replacementRunId)
      return errorResponse(
        c,
        'conflict_detected',
        `This run was replaced by ${run.replacementRunId}. Review and finalize the replacement instead.`,
        409,
      )
    if (run.status !== 'ready_for_review' && run.status !== 'reviewing')
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'This run is not ready for finalization.',
        400,
      )
    if (
      run.detectionMode === 'heuristics+supplement' &&
      body.data.degradedDetectionAcknowledged !== true
    )
      return errorResponse(
        c,
        'validation_failed',
        'Acknowledge that model detection did not run before finalising.',
        400,
      )
    if (
      run.detectionMode === 'unknown' &&
      body.data.unknownDetectionAcknowledged !== true
    )
      return errorResponse(
        c,
        'validation_failed',
        'Acknowledge that the detection mode was not recorded before finalising.',
        400,
      )
    const mixedGroups = mixedTextGroups(run.spans, run.decisions)
    if (
      mixedGroups.length > 0 &&
      !isDocxMimeOrFilename(run.sourceFilename, run.sourceMimeType)
    )
      return errorResponse(
        c,
        'mixed_text_decisions',
        mixedGroups.length === 1
          ? 'One piece of repeated text has different decisions: it is redacted in one place and kept visible in another. Decide every occurrence the same way before finalising.'
          : `${String(mixedGroups.length)} pieces of repeated text have different decisions: each is redacted in one place and kept visible in another. Decide every occurrence the same way before finalising.`,
        409,
      )
    const textObjectKey = await getRunTextObjectKey(pool, run, user)
    if (!textObjectKey)
      return errorResponse(
        c,
        'document_version_not_found',
        'Document text is not available for this run.',
        404,
      )
    const text = await storage.readText(textObjectKey)
    const source = await getRunSourceFile(pool, run, user)
    let sourceBytes: Buffer | null = null
    let coverageUnchecked = false
    if (!source || !storage.readBinary) {
      coverageUnchecked = true
    } else {
      try {
        sourceBytes = await storage.readBinary(source.objectKey)
      } catch {
        return errorResponse(
          c,
          'extraction_coverage_incomplete',
          'This run cannot be finalized: the stored source could not be read, so extraction coverage is unproven.',
          409,
        )
      }
    }
    const uncoveredRegions = await findUncoveredRegions({
      filename: run.sourceFilename,
      mimeType: source?.mimeType ?? run.sourceMimeType ?? null,
      sourceBytes,
      extractedText: text,
      ooxmlLimits: limits.ooxmlLimits,
    })
    if (uncoveredRegions.length > 0)
      return errorResponse(
        c,
        'extraction_coverage_incomplete',
        `This run cannot be finalized: part of the source was never examined (${uncoveredRegions.join('; ')}), so completeness cannot be claimed.`,
        409,
      )
    let output: string
    let tokenMap: Record<string, string>
    try {
      tokenMap = createTokenMap(text, run.spans, run.decisions)
      output =
        body.data.outputMode === 'redacted'
          ? applyRedacted(text, run.spans, run.decisions)
          : applyPseudonymised(text, run.spans, run.decisions)
    } catch (error) {
      if (error instanceof RedactionSpanIntegrityError)
        return errorResponse(
          c,
          'redaction_span_integrity_error',
          'The document text changed; create a new redaction run before finalizing.',
          409,
        )
      throw error
    }
    const outputId = `out_${crypto.randomUUID()}`
    const objectKey = run.matterId
      ? `org/${run.organisationId}/matters/${run.matterId}/outputs/${outputId}`
      : `org/${run.organisationId}/outputs/${outputId}`

    let outputMimeType = 'text/plain'
    let outputFilename = redactedTextFilename('document')
    let outputSha256: string
    let securePdf = false
    let attemptedBurn: 'pdf' | 'docx' | null = null
    let downgradeReason: OutputDowngradeReason | null = null

    if (body.data.outputMode === 'redacted') {
      const layoutObjectKey = await getRunLayoutObjectKey(pool, run, user)
      try {
        if (!storage.writeBinary)
          throw new HardRedactionOutputError(
            'container_unavailable',
            'Secure PDF storage is not available.',
          )
        const secure = await buildHardRedactionPdf({
          run,
          ooxmlLimits: limits.ooxmlLimits,
          sourceText: text,
          redactedText: output,
          source,
          layoutObjectKey,
          storage,
          renderer,
          tokenMap,
        })
        await storage.writeBinary(objectKey, Buffer.from(secure.bytes))
        outputMimeType = 'application/pdf'
        outputFilename = secure.filename
        outputSha256 = sha256(secure.bytes)
        securePdf = true
      } catch (error) {
        if (error instanceof RedactionSpanIntegrityError)
          return errorResponse(
            c,
            'redaction_span_integrity_error',
            'The document text changed; create a new redaction run before finalizing.',
            409,
          )
        await storage.delete(objectKey)
        return await reportSecurePdfFailure(c, pool, {
          runId: run.id,
          organisationId: run.organisationId,
          userId: user.id,
          outputMode: 'redacted',
          error,
        })
      }
    } else {
      try {
        const sourceMimeType = run.sourceMimeType ?? source?.mimeType ?? null
        const canWriteDocx =
          Boolean(source) &&
          Boolean(storage.readBinary) &&
          Boolean(storage.writeBinary) &&
          isDocxMimeOrFilename(run.sourceFilename, sourceMimeType)

        if (canWriteDocx && source) {
          attemptedBurn = 'docx'
          const docxBytes = await storage.readBinary!(source.objectKey)
          const redactedDocx = await buildRedactedDocx({
            docxBytes: Buffer.from(docxBytes),
            ooxmlLimits: limits.ooxmlLimits,
            text,
            spans: run.spans,
            decisions: run.decisions,
            outputMode: 'pseudonymised',
            tokenMap,
          })
          await storage.writeBinary!(objectKey, Buffer.from(redactedDocx))
          outputMimeType =
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          outputFilename = redactedDocxFilename('document')
          outputSha256 = sha256(redactedDocx)
        } else {
          await storage.writeText(objectKey, output)
          outputSha256 = sha256(Buffer.from(output, 'utf8'))
        }
      } catch (error) {
        if (error instanceof RedactionSpanIntegrityError) throw error
        console.error('redaction_burn_failed', {
          requestId: c.get('requestId'),
          runId: run.id,
          reason: burnFallbackReason(error),
        })
        await storage.delete(objectKey)
        if (attemptedBurn) downgradeReason = burnFallbackReason(error)
        await storage.writeText(objectKey, output)
        outputMimeType = 'text/plain'
        outputFilename = redactedTextFilename('document')
        outputSha256 = sha256(Buffer.from(output, 'utf8'))
      }
    }

    const outputDowngrade =
      attemptedBurn && downgradeReason
        ? { from: attemptedBurn, reason: downgradeReason }
        : null

    let result
    try {
      result = await finalizeRedactionRun({
        pool,
        organisationId: user.organisationId,
        runId: run.id,
        outputMode: body.data.outputMode,
        tokenMap,
        outputId,
        userId: user.id,
        requestId: c.get('requestId'),
        degradedDetectionAcknowledged:
          body.data.degradedDetectionAcknowledged === true,
        unknownDetectionAcknowledged:
          body.data.unknownDetectionAcknowledged === true,
        outputMimeType,
        outputFilename,
        outputDowngrade,
        outputSha256,
        securePdf,
      })
    } catch (error) {
      await storage.delete(objectKey)
      throw error
    }
    if (result.kind === 'not_found') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    }
    if (result.kind === 'already_finalized') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'redaction_already_finalized',
        'This run has already been finalized.',
        409,
      )
    }
    if (result.kind === 'replaced') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'conflict_detected',
        `This run was replaced by ${result.replacementRunId}. Review and finalize the replacement instead.`,
        409,
      )
    }
    if (result.kind === 'not_reviewable') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'This run is not ready for finalization.',
        400,
      )
    }
    if (result.kind === 'acknowledgement_required') {
      await storage.delete(objectKey)
      return errorResponse(
        c,
        'validation_failed',
        run.detectionMode === 'unknown'
          ? 'Acknowledge that the detection mode was not recorded before finalising.'
          : 'Acknowledge that model detection did not run before finalising.',
        400,
      )
    }
    const unreviewedSpanIds = result.run.spans
      .filter((span) => !result.run.decisions[span.id])
      .map((span) => span.id)
    if (coverageUnchecked) {
      await appendAuditLog(pool, {
        organisationId: user.organisationId,
        userId: user.id,
        entityType: 'redaction_run',
        entityId: result.run.id,
        action: 'redaction.coverage_unchecked',
        metadata: {
          reason:
            'No stored source recorded; extraction coverage could not be checked.',
        },
        requestId: c.get('requestId'),
      })
    }
    return c.json({
      run: publicRun(result.run),
      output: result.output,
      warnings: { unreviewedSpanIds, coverageUnchecked, outputDowngrade },
    })
  })

  routes.get('/api/redaction-runs/:runId/output', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'view')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (!run.outputId)
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'This run has not been finalized.',
        400,
      )
    const objectKey = await getRedactionOutputKey(pool, run)
    if (!objectKey)
      return errorResponse(
        c,
        'output_not_found',
        'Redaction output is not available.',
        404,
      )
    const mimeType = outputMimeTypeOf(run)
    const filename = outputFilenameOf(mimeType)
    if (isBinaryOutput(mimeType)) {
      return c.json({
        mimeType,
        filename,
        text: null,
        outputId: run.outputId,
        sha256: run.summary.outputSha256 ?? null,
        securePdf: isSecurePdfOutput(run, mimeType),
      })
    }
    const text = await storage.readText(objectKey)
    return c.json({
      mimeType,
      filename,
      text,
      outputId: run.outputId,
      sha256: run.summary.outputSha256 ?? sha256(Buffer.from(text, 'utf8')),
      securePdf: false,
    })
  })

  routes.get('/api/redaction-runs/:runId/output/file', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'view')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (!run.outputId)
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'This run has not been finalized.',
        400,
      )
    const objectKey = await getRedactionOutputKey(pool, run)
    if (!objectKey)
      return errorResponse(
        c,
        'output_not_found',
        'Redaction output is not available.',
        404,
      )
    const mimeType = outputMimeTypeOf(run)
    const filename = outputFilenameOf(mimeType)
    const disposition = downloadContentDisposition(
      safeDownloadFilename(filename, { fallback: 'redacted-output' }),
    )
    if (isBinaryOutput(mimeType)) {
      if (!storage.readBinary)
        return errorResponse(
          c,
          'output_not_found',
          'Redaction output is not available.',
          404,
        )
      const bytes = await storage.readBinary(objectKey)
      return new Response(Uint8Array.from(bytes), {
        status: 200,
        headers: {
          'content-type': mimeType,
          'content-disposition': disposition,
          'cache-control': 'private',
          'x-content-type-options': 'nosniff',
        },
      })
    }
    const text = await storage.readText(objectKey)
    return new Response(text, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': disposition,
        'cache-control': 'private',
        'x-content-type-options': 'nosniff',
      },
    })
  })

  routes.get('/api/redaction-runs/:runId/token-map', async (c) => {
    const user = await requireUser(c, pool)
    if (user instanceof Response) return user
    const run = await getRedactionRun(pool, user, c.req.param('runId'), 'view')
    if (!run)
      return errorResponse(
        c,
        'redaction_run_not_found',
        'Redaction run not found.',
        404,
      )
    if (
      run.status !== 'finalized' ||
      run.summary.outputMode !== 'pseudonymised' ||
      !run.summary.tokenMap
    )
      return errorResponse(
        c,
        'redaction_run_not_reviewable',
        'No pseudonymisation token map exists for this run.',
        400,
      )
    await appendAuditLog(pool, {
      organisationId: user.organisationId,
      userId: user.id,
      entityType: 'redaction_run',
      entityId: run.id,
      action: 'redaction.token_map_access',
      metadata: { tokenCount: Object.keys(run.summary.tokenMap).length },
      requestId: c.get('requestId'),
    })
    return c.json({ tokenMap: run.summary.tokenMap })
  })

  return routes
}
