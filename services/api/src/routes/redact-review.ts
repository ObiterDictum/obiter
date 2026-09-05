import { Hono } from 'hono'
import type { Pool } from 'pg'
import {
  documentTextLayoutSchema,
  redactionFinalizeInputSchema,
  spanDecisionSchema,
  type DocumentTextLayout,
} from '@obiter/contracts'
import {
  applyPseudonymised,
  applyRedacted,
  createTokenMap,
  RedactionSpanIntegrityError,
} from '@obiter/redaction-policy'
import { appendAuditLog } from '../database'
import { createDocumentMediaResponse } from '../document-media-response'
import { findUncoveredRegions } from '../extraction-coverage'
import {
  finalizeRedactionRun,
  getRedactionOutputKey,
  getRedactionRun,
  getRunLayoutObjectKey,
  getRunSourceFile,
  getRunTextObjectKey,
  publicRun,
  recordSpanDecision,
} from '../redaction-database'
import {
  buildRedactedPdf,
  isPdfMimeOrFilename,
  redactedPdfFilename,
  redactedTextFilename,
} from '../redaction-pdf-output'
import type { StorageService } from '../storage'
import {
  errorResponse,
  jsonBody,
  requireUser,
  type RouteVariables,
} from './redact-shared'

/**
 * Deliberately a second check, not a duplicate of mimeTypeFromStoredFileType.
 * That helper translates stored types and passes real MIME types through
 * unchanged, which is correct for its callers: standalone runs store real MIME
 * types while document_versions stores short ones. This allowlist is the
 * control. The response must not trust a stored value, so an unrecognised type
 * degrades to octet-stream here, at the boundary, rather than upstream.
 *
 * Do not collapse these into one. Hardening the translator instead would put
 * the control back on a single upstream path and leave the response trusting
 * its input, which is the finding this closes. It would also return
 * octet-stream for every standalone run, breaking PDF review. See P0.19.
 */
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

export function createRedactReviewRoutes(pool: Pool, storage: StorageService) {
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
    return c.json({ run: publicRun(run) })
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
    const textObjectKey = await getRunTextObjectKey(pool, run)
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
    const source = await getRunSourceFile(pool, run)
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
    const layoutObjectKey = await getRunLayoutObjectKey(pool, run)
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
          decision: decision.data,
          category: result.span.category,
        },
        requestId: c.get('requestId'),
      })
      return c.json({ run: publicRun(result.run) })
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
    const textObjectKey = await getRunTextObjectKey(pool, run)
    if (!textObjectKey)
      return errorResponse(
        c,
        'document_version_not_found',
        'Document text is not available for this run.',
        404,
      )
    const text = await storage.readText(textObjectKey)
    const source = await getRunSourceFile(pool, run)
    // Fail closed: finalising claims the output is complete, so refuse when
    // the source holds text extraction never examined (footnotes, endnotes,
    // comments, textboxes, fused PDF runs). Checked here — after the text
    // read, before any artifact write — so refusal leaves no output behind.
    // 409 matches the other finalize conflicts (already-finalized,
    // span-integrity); uncovered regions ride in the message because the
    // shared error envelope carries no extra fields, and the review UI
    // already renders the message. E43 owns extracting these regions.
    // No stored source (legacy runs predate the guard) is the one exception:
    // those proceed but are marked unchecked below. A stored source that
    // cannot be read is not evidence of coverage, so it refuses like an
    // uncovered region.
    let sourceBytes: Buffer | null = null
    let coverageUnchecked = false
    if (!source || !storage.readBinary) {
      // No stored source recorded, so coverage cannot be checked. The bytes
      // never existed (legacy runs predate the guard), which is distinct
      // from a stored source that failed to read — see below.
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
    const artifactId = `art_${crypto.randomUUID()}`
    const objectKey = run.matterId
      ? `org/${run.organisationId}/matters/${run.matterId}/artifacts/${artifactId}`
      : `org/${run.organisationId}/artifacts/${artifactId}`

    let outputMimeType = 'text/plain'
    let outputFilename = redactedTextFilename(run.sourceFilename)
    try {
      const layoutObjectKey = await getRunLayoutObjectKey(pool, run)
      const canWritePdf =
        Boolean(source) &&
        Boolean(layoutObjectKey) &&
        Boolean(storage.readBinary) &&
        Boolean(storage.writeBinary) &&
        isPdfMimeOrFilename(
          run.sourceFilename,
          run.sourceMimeType ?? source?.mimeType ?? null,
        )

      if (canWritePdf && source && layoutObjectKey) {
        const parsedLayout = documentTextLayoutSchema.safeParse(
          JSON.parse(await storage.readText(layoutObjectKey)),
        )
        // Invalid stored geometry must follow the same fail-closed path as
        // missing geometry. An empty layout makes any accepted span raise
        // RedactionCoverGeometryError before source pixels are rasterized.
        const layout: DocumentTextLayout = parsedLayout.success
          ? parsedLayout.data
          : {
              version: 2,
              pages: [{ width: 1, height: 1 }],
              segments: [],
            }
        const pdfBytes = await storage.readBinary!(source.objectKey)
        const redactedPdf = await buildRedactedPdf({
          pdfBytes,
          layout,
          spans: run.spans,
          decisions: run.decisions,
          outputMode: body.data.outputMode,
          tokenMap,
        })
        await storage.writeBinary!(objectKey, Buffer.from(redactedPdf))
        outputMimeType = 'application/pdf'
        outputFilename = redactedPdfFilename(run.sourceFilename)
      } else {
        await storage.writeText(objectKey, output)
      }
    } catch (error) {
      if (error instanceof RedactionSpanIntegrityError) throw error
      // PDF burn failed — fall back to text output so finalize still completes.
      // Do not log span ids, filenames, or document content (cover-geometry
      // errors name span ids in their message).
      const reason =
        error instanceof Error && error.name === 'RedactionCoverGeometryError'
          ? 'cover geometry missing for one or more spans'
          : error instanceof Error
            ? error.message
            : 'unknown failure'
      console.error('redaction_pdf_burn_failed', {
        requestId: c.get('requestId'),
        runId: run.id,
        reason,
      })
      await storage.writeText(objectKey, output)
      outputMimeType = 'text/plain'
      outputFilename = redactedTextFilename(run.sourceFilename)
    }

    let result
    try {
      result = await finalizeRedactionRun({
        pool,
        organisationId: user.organisationId,
        runId: run.id,
        outputMode: body.data.outputMode,
        tokenMap,
        artifactId,
        userId: user.id,
        requestId: c.get('requestId'),
        degradedDetectionAcknowledged:
          body.data.degradedDetectionAcknowledged === true,
        unknownDetectionAcknowledged:
          body.data.unknownDetectionAcknowledged === true,
        outputMimeType,
        outputFilename,
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
      artifact: result.artifact,
      warnings: { unreviewedSpanIds, coverageUnchecked },
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
    if (!run.outputArtifactId)
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
        'artifact_not_found',
        'Redaction output is not available.',
        404,
      )
    const mimeType = run.summary.outputMimeType ?? 'text/plain'
    const filename =
      run.summary.outputFilename ??
      (mimeType === 'application/pdf'
        ? redactedPdfFilename(run.sourceFilename)
        : redactedTextFilename(run.sourceFilename))
    if (mimeType === 'application/pdf') {
      return c.json({
        mimeType,
        filename,
        text: null,
      })
    }
    return c.json({
      mimeType,
      filename,
      text: await storage.readText(objectKey),
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
    if (!run.outputArtifactId)
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
        'artifact_not_found',
        'Redaction output is not available.',
        404,
      )
    const mimeType = run.summary.outputMimeType ?? 'text/plain'
    const filename =
      run.summary.outputFilename ??
      (mimeType === 'application/pdf'
        ? redactedPdfFilename(run.sourceFilename)
        : redactedTextFilename(run.sourceFilename))
    const safeName = filename.replaceAll('"', '')
    if (mimeType === 'application/pdf') {
      if (!storage.readBinary)
        return errorResponse(
          c,
          'artifact_not_found',
          'Redaction output is not available.',
          404,
        )
      const bytes = await storage.readBinary(objectKey)
      return new Response(Uint8Array.from(bytes), {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="${safeName}"`,
          'cache-control': 'private, max-age=60',
          'x-content-type-options': 'nosniff',
        },
      })
    }
    const text = await storage.readText(objectKey)
    return new Response(text, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'content-disposition': `attachment; filename="${safeName}"`,
        'cache-control': 'private, max-age=60',
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
