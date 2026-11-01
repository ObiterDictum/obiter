import type { Pool } from 'pg'
import { DocumentExtractionError } from './document-extraction'
import {
  documentTextTooLongMessage,
  extractedTextWithinLimit,
} from './document-extraction-limits'
import { computeSummary, selectMutationRun } from './redaction-database'
import { appendAuditLog } from './database'
import {
  detectRedactionSpans,
  detectionMode,
  type DetectionProgressCallback,
  type DetectionResult,
} from './redaction-detection'
import { planDetectionWindows } from './redaction-detection-windows'
import { extractRedactionContent } from './redaction-extraction'
import type { StorageService } from './storage'
import type { ApiRequestLimits } from './request-limits'
import { DEFAULT_API_REQUEST_LIMITS } from './request-limits'

interface DetectionJob {
  id: string
  organisation_id: string
  created_by: string
  detection_input_key: string
  detection_input_type: 'pdf' | 'docx' | 'txt'
  detection_attempts: number
  detection_lease_token: string
}

const LEASE_SECONDS = 90
const MAX_ATTEMPTS = 3
const DETECTION_WORKER_CONCURRENCY = 2

export async function claimDetectionJob(pool: Pool) {
  const result = await pool.query<DetectionJob>(
    `update redaction_runs set
    detection_lease_token = $1, detection_lease_until = now() + make_interval(secs => $2),
    detection_attempts = detection_attempts + 1, detection_completed = 0, detection_total = 0
    where id = (select id from redaction_runs
      where status = 'detecting' and deleted_at is null and detection_input_key is not null
        and (detection_lease_until is null or detection_lease_until < now())
      order by created_at for update skip locked limit 1)
    returning id, organisation_id, created_by, detection_input_key, detection_input_type, detection_attempts, detection_lease_token`,
    [crypto.randomUUID(), LEASE_SECONDS],
  )
  return result.rows[0] ?? null
}

export async function retryDetectionJob(
  pool: Pool,
  id: string,
  organisationId: string,
  userId: string,
  requestId: string,
) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const run = await selectMutationRun(client, {
      organisationId,
      userId,
      runId: id,
      includeDeleted: false,
    })
    if (!run || run.status !== 'failed') {
      await client.query('rollback')
      return false
    }
    const result = await client.query(
      `update redaction_runs set status = 'detecting',
    detection_attempts = 0, detection_completed = 0, detection_total = 0,
    detection_lease_token = null, detection_lease_until = null,
    summary_json = summary_json - 'failureReason', updated_at = now()
    where id = $1 and organisation_id = $2 and status = 'failed'
      and deleted_at is null and detection_input_key is not null returning id`,
      [id, organisationId],
    )
    if (result.rows.length)
      await appendAuditLog(client, {
        organisationId,
        userId,
        entityType: 'redaction_run',
        entityId: id,
        action: 'redaction.run_retry',
        metadata: {},
        requestId,
      })
    await client.query('commit')
    return result.rows.length > 0
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

class JobInterrupted extends Error {}

async function withJobLock(
  pool: Pool,
  identity: string[],
  operation: (client: Pick<Pool, 'query'>) => Promise<void>,
) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    const locked = await client.query(
      `select id from redaction_runs where id = $1 and organisation_id = $2
      and detection_lease_token = $3 and status = 'detecting' and deleted_at is null for update`,
      identity,
    )
    if (!locked.rows.length) throw new JobInterrupted()
    await operation(client)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

export async function processDetectionJob(
  pool: Pool,
  storage: StorageService,
  job: DetectionJob,
  options: {
    detect?: (
      text: string,
      progress?: DetectionProgressCallback,
    ) => Promise<DetectionResult>
    stopping?: () => boolean
    limits?: ApiRequestLimits
  } = {},
) {
  const identity = [job.id, job.organisation_id, job.detection_lease_token]
  const guard = `id = $1 and organisation_id = $2 and detection_lease_token = $3 and status = 'detecting' and deleted_at is null`
  const base = `org/${job.organisation_id}/redaction-runs/${job.id}`
  const textKey = `${base}/source`
  const layoutKey = `${base}/layout.json`
  let leaseLost = false
  let heartbeatError = false
  const heartbeat = setInterval(() => {
    void pool
      .query(
        `update redaction_runs set detection_lease_until = now() + make_interval(secs => $4) where ${guard}`,
        [...identity, LEASE_SECONDS],
      )
      .then(
        (result) => {
          if (result.rowCount !== 1) leaseLost = true
        },
        () => {
          heartbeatError = true
        },
      )
  }, 15_000)
  const progress: DetectionProgressCallback = async (completed, total) => {
    if (leaseLost || heartbeatError || options.stopping?.())
      throw new JobInterrupted()
    const result = await pool.query(
      `update redaction_runs set detection_completed = $4, detection_total = $5,
      detection_lease_until = now() + make_interval(secs => $6), updated_at = now() where ${guard}`,
      [...identity, completed, total, LEASE_SECONDS],
    )
    if (result.rowCount !== 1) {
      leaseLost = true
      throw new JobInterrupted()
    }
  }
  try {
    if (job.detection_attempts > MAX_ATTEMPTS)
      throw new Error('lease_exhausted')
    if (!storage.readBinary) throw new Error('source_unavailable')
    const extracted = await extractRedactionContent(
      job.detection_input_type,
      await storage.readBinary(job.detection_input_key),
      {
        ooxmlLimits: (options.limits ?? DEFAULT_API_REQUEST_LIMITS).ooxmlLimits,
      },
    )
    if (!extractedTextWithinLimit(extracted.text))
      throw new DocumentExtractionError(
        documentTextTooLongMessage(extracted.text.length),
        true,
      )
    const detection = await (options.detect ?? detectRedactionSpans)(
      extracted.text,
      progress,
    )
    const total = planDetectionWindows(extracted.text).length
    await progress(total, total)
    const spans = detection.spans.map((span, index) => ({
      ...span,
      id: `span_${job.id}_${index + 1}`,
    }))
    await withJobLock(pool, identity, async (client) => {
      await storage.writeText(textKey, extracted.text)
      if (extracted.layout)
        await storage.writeText(layoutKey, JSON.stringify(extracted.layout))
      const result = await client.query(
        `update redaction_runs set status = 'ready_for_review', spans_json = $4::jsonb,
      summary_json = $5::jsonb, detector_version = $6, detection_mode = $7,
      source_text_object_key = $8, source_layout_object_key = $9,
      detection_completed = $10, detection_total = $10,
      detection_lease_token = null, detection_lease_until = null, updated_at = now() where ${guard}`,
        [
          ...identity,
          JSON.stringify(spans),
          JSON.stringify(computeSummary(spans, {})),
          detection.detectorVersion,
          detectionMode(detection.degraded),
          textKey,
          extracted.layout ? layoutKey : null,
          total,
        ],
      )
      if (result.rowCount !== 1) throw new JobInterrupted()
      await appendAuditLog(client, {
        organisationId: job.organisation_id,
        userId: job.created_by,
        entityType: 'redaction_run',
        entityId: job.id,
        action: 'redaction.detection_complete',
        metadata: {
          detectionMode: detectionMode(detection.degraded),
          spanCount: spans.length,
          detectorVersion: detection.detectorVersion,
        },
        requestId: `job_${job.id}_${job.detection_attempts}`,
      })
    })
  } catch (error) {
    if (leaseLost) return
    if (error instanceof JobInterrupted) {
      await pool.query(
        `update redaction_runs set detection_lease_token = null, detection_lease_until = null,
        detection_attempts = greatest(0, detection_attempts - $4) where ${guard}`,
        [...identity, options.stopping?.() ? 1 : 0],
      )
      return
    }
    const extractionReason =
      error instanceof DocumentExtractionError &&
      error.message.includes('2,000,000')
        ? 'The document exceeds the 2,000,000-character text limit.'
        : error instanceof DocumentExtractionError &&
            /scanned|text layer|no extractable/i.test(error.message)
          ? 'This document has no readable text layer. OCR is not available yet.'
          : 'The document could not be read for redaction. It may be damaged or exceed the package limits.'
    const reason =
      job.detection_attempts > MAX_ATTEMPTS
        ? 'Detection stopped repeatedly before completing. Retry to start again.'
        : error instanceof DocumentExtractionError
          ? extractionReason
          : 'Redaction detection could not complete. Retry the stored source.'
    await withJobLock(pool, identity, async (client) => {
      await storage.delete(textKey)
      await storage.delete(layoutKey)
      const result = await client.query(
        `update redaction_runs set status = 'failed',
      summary_json = jsonb_set(summary_json, '{failureReason}', to_jsonb($4::text)),
      detection_lease_token = null, detection_lease_until = null, updated_at = now() where ${guard}`,
        [...identity, reason],
      )
      if (result.rowCount === 1) {
        console.error('redaction_detection_job_failed', {
          runId: job.id,
          reason,
        })
      }
    })
  } finally {
    clearInterval(heartbeat)
  }
}

export function startDetectionWorker(
  pool: Pool,
  storage: StorageService,
  options: {
    limits?: ApiRequestLimits
    detect?: (
      text: string,
      progress?: DetectionProgressCallback,
    ) => Promise<DetectionResult>
  } = {},
) {
  let stopping = false
  let wake: (() => void) | undefined
  const active = new Set<Promise<void>>()
  const start = (job: DetectionJob) => {
    const running: Promise<void> = processDetectionJob(pool, storage, job, {
      stopping: () => stopping,
      limits: options.limits,
      detect: options.detect,
    })
      .catch(() => {
        console.error('redaction_detection_job_unavailable')
      })
      .finally(() => {
        active.delete(running)
      })
    active.add(running)
  }
  const finished = (async () => {
    while (!stopping) {
      try {
        if (active.size >= DETECTION_WORKER_CONCURRENCY) {
          await Promise.race(active)
          continue
        }
        const job = await claimDetectionJob(pool)
        if (job) {
          start(job)
          continue
        }
      } catch {
        console.error('redaction_detection_worker_unavailable')
      }
      if (!stopping)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 1_000)
          wake = () => {
            clearTimeout(timer)
            resolve()
          }
        })
    }
    await Promise.all(active)
  })()
  return {
    stop: async () => {
      stopping = true
      wake?.()
      await finished
    },
  }
}
