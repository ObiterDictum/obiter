import type { Pool } from 'pg'
import { detectRedactionSpans } from './redaction-detection'
import { getRedactionRun, getRunTextObjectKey } from './redaction-database'
import {
  createRedetectionRun,
  getRedetectionRun,
} from './redaction-run-creation'
import type { StorageService } from './storage'

export async function redetectRedactionRun(input: {
  pool: Pool
  storage: StorageService
  organisationId: string
  userId: string
  runId: string
  requestId: string
}) {
  const sourceRun = await getRedactionRun(
    input.pool,
    input.organisationId,
    input.runId,
  )
  if (!sourceRun) return { kind: 'not_found' as const }
  if (sourceRun.detectionMode === 'model+supplement')
    return { kind: 'already_model_detected' as const }
  const existing = await getRedetectionRun(
    input.pool,
    input.organisationId,
    sourceRun.id,
  )
  if (existing) return { kind: 'existing' as const, run: existing }

  const sourceObjectKey = await getRunTextObjectKey(input.pool, sourceRun)
  if (!sourceObjectKey) return { kind: 'source_unavailable' as const }
  const text = await input.storage.readText(sourceObjectKey)

  let detection
  try {
    detection = await detectRedactionSpans(text)
  } catch (error) {
    return {
      kind: 'detection_failed' as const,
      reason: error instanceof Error ? error.message : 'unknown failure',
    }
  }

  if (detection.degraded) return { kind: 'model_unavailable' as const }

  const newRunId = `red_${crypto.randomUUID()}`
  const stagedObjectKey = sourceRun.matterId
    ? null
    : `org/${input.organisationId}/redaction-runs/${newRunId}/source`
  if (stagedObjectKey) {
    try {
      await input.storage.writeText(stagedObjectKey, text)
    } catch (error) {
      await input.storage.delete(stagedObjectKey)
      throw error
    }
  }

  let result
  try {
    result = await createRedetectionRun({
      pool: input.pool,
      organisationId: input.organisationId,
      userId: input.userId,
      sourceRunId: sourceRun.id,
      newRunId,
      sourceTextObjectKey: stagedObjectKey,
      spans: detection.spans,
      detectorVersion: detection.detectorVersion,
      detectionMode: 'model+supplement',
      requestId: input.requestId,
    })
  } catch (error) {
    if (!stagedObjectKey) throw error
    let persisted
    try {
      persisted = await getRedetectionRun(
        input.pool,
        input.organisationId,
        sourceRun.id,
      )
    } catch {
      throw error
    }
    if (persisted) {
      if (persisted.sourceTextObjectKey !== stagedObjectKey)
        await input.storage.delete(stagedObjectKey)
      return { kind: 'existing' as const, run: persisted }
    }
    await input.storage.delete(stagedObjectKey)
    throw error
  }

  if (result.kind !== 'created' && stagedObjectKey)
    await input.storage.delete(stagedObjectKey)
  return result
}
