import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterAll, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { z } from 'zod'
import {
  redactionDetectionProgressSchema,
  redactionRunStatusSchema,
} from '@obiter/contracts'
import type { AuthzUser, AuthzVariables } from './authz'
import { createRedactionDetector } from './redaction-detection'
import {
  claimDetectionJob,
  processDetectionJob,
  startDetectionWorker,
} from './redaction-detection-jobs'
import { createRedactRunCreationRoutes } from './routes/redact-run-creation'
import { createRedactReviewRoutes } from './routes/redact-review'
import {
  cleanupMatter,
  ownerUser,
  seedMatter,
  storageFor,
} from './routes/document-write-share-revocation.test-support'
import { createTestPool } from './test-database.test-support'

const pool = createTestPool()
afterAll(() => pool.end())
const detector = createRedactionDetector({
  loadClassifier: async () => async () => [],
  detectNer: async () => [],
  log: () => {},
})
const responseSchema = z.object({
  run: z.object({
    id: z.string(),
    status: redactionRunStatusSchema,
    detectionProgress: redactionDetectionProgressSchema,
    spans: z.array(z.unknown()),
    detectorVersion: z.string().nullable(),
    summary: z.object({ failureReason: z.string().optional() }),
  }),
})
const readRun = async (response: Response) =>
  responseSchema.parse(await response.json()).run

async function fixture() {
  const seed = await seedMatter(pool, null)
  const storage = storageFor(seed)
  const app = (user: AuthzUser = ownerUser(seed)) => {
    const routes = new Hono<{ Variables: AuthzVariables }>()
    routes.use('*', async (c, next) => {
      c.set('requestId', 'req_jobs')
      c.set('user', user)
      await next()
    })
    routes.route('/', createRedactRunCreationRoutes(pool, storage))
    routes.route('/', createRedactReviewRoutes(pool, storage))
    return routes
  }
  const read = async (id: string) =>
    readRun(await app().request(`/api/redaction-runs/${id}`))
  const create = async (text = 'Email synthetic.person@example.com') => {
    const form = new FormData()
    form.set('file', new File([text], 'synthetic.txt', { type: 'text/plain' }))
    const response = await app().request('/api/redaction-runs', {
      method: 'POST',
      body: form,
    })
    expect(response.status).toBe(202)
    const run = await readRun(response)
    expect(run.status).toBe('detecting')
    expect(run.spans).toEqual([])
    return run.id
  }
  const cleanup = async () => {
    await pool.query('delete from redaction_runs where organisation_id = $1', [
      seed.orgId,
    ])
    await cleanupMatter(pool, seed)
  }
  return { seed, storage, app, create, read, cleanup }
}

it('returns immediately, denies review until ready, reports progress and preserves synchronous spans', async () => {
  const f = await fixture()
  try {
    const text = 'Email synthetic.person@example.com. '.repeat(7_000)
    const id = await f.create(text)
    expect(
      (await f.app().request(`/api/redaction-runs/${id}/document-text`)).status,
    ).toBe(409)
    expect(
      (await f.app().request(`/api/redaction-runs/${id}/spans`)).status,
    ).toBe(409)
    expect(
      (await f.app().request(`/api/redaction-runs/${id}/source-file`)).status,
    ).toBe(409)
    const job = await claimDetectionJob(pool)
    if (!job) throw new Error('Expected queued job')
    expect(job.id).toBe(id)
    const progress: number[] = []
    await processDetectionJob(pool, f.storage, job, {
      detect: (source, report) =>
        detector(source, async (completed, total) => {
          await report?.(completed, total)
          expect((await f.read(id)).detectionProgress).toEqual({
            completed,
            total,
          })
          progress.push(completed)
        }),
    })
    expect(progress).toContain(1)
    const result = await f.read(id)
    expect(result.status).toBe('ready_for_review')
    const audits = await pool.query<{ action: string }>(
      'select action from audit_logs where entity_id = $1 order by created_at',
      [id],
    )
    expect(audits.rows.map((row) => row.action)).toEqual([
      'redaction.run_create',
      'redaction.detection_complete',
    ])
    const expected = await detector(text)
    expect(result.spans).toEqual(
      expected.spans.map((span, index) => ({
        ...span,
        id: `span_${id}_${index + 1}`,
      })),
    )
    expect(result.detectorVersion).toBe(expected.detectorVersion)
    expect(result.detectionProgress.completed).toBe(
      result.detectionProgress.total,
    )
    const source = await (
      await f.app().request(`/api/redaction-runs/${id}/document-text`)
    ).json()
    expect(z.object({ text: z.string() }).parse(source).text).toBe(text)
    const stranger = f.app({
      id: f.seed.strangerId,
      organisationId: f.seed.otherOrgId,
      role: 'member',
    })
    expect((await stranger.request(`/api/redaction-runs/${id}`)).status).toBe(
      404,
    )
    expect(
      (
        await stranger.request(`/api/redaction-runs/${id}/retry`, {
          method: 'POST',
        })
      ).status,
    ).toBe(404)
  } finally {
    await f.cleanup()
  }
})

it('records a safe failure, deletes derived text and retries the retained source', async () => {
  const f = await fixture()
  try {
    const id = await f.create()
    const job = await claimDetectionJob(pool)
    if (!job) throw new Error('Expected queued job')
    await processDetectionJob(pool, f.storage, job, {
      detect: async () => {
        throw new Error('PRIVATE DOCUMENT TEXT')
      },
    })
    const failed = await f.read(id)
    expect(failed.status).toBe('failed')
    expect(failed.summary.failureReason).toContain('Retry')
    expect(JSON.stringify(failed)).not.toContain('PRIVATE DOCUMENT TEXT')
    expect(
      f.storage.text.has(`org/${f.seed.orgId}/redaction-runs/${id}/source`),
    ).toBe(false)
    expect(f.storage.binary.has(job.detection_input_key)).toBe(true)
    const retry = await f
      .app()
      .request(`/api/redaction-runs/${id}/retry`, { method: 'POST' })
    expect(retry.status).toBe(202)
    expect((await readRun(retry)).status).toBe('detecting')
    const retryAudit = await pool.query(
      'select id from audit_logs where entity_id = $1 and action = $2',
      [id, 'redaction.run_retry'],
    )
    expect(retryAudit.rows).toHaveLength(1)
    const next = await claimDetectionJob(pool)
    if (!next) throw new Error('Expected retry job')
    await processDetectionJob(pool, f.storage, next, { detect: detector })
    expect((await f.read(id)).status).toBe('ready_for_review')
  } finally {
    await f.cleanup()
  }
})

it('claims exclusively, fences stale owners and bounds restart retries', async () => {
  const f = await fixture()
  try {
    const id = await f.create()
    const claims = await Promise.all([
      claimDetectionJob(pool),
      claimDetectionJob(pool),
    ])
    expect(claims.filter(Boolean)).toHaveLength(1)
    const old = claims.find((job) => job !== null)
    if (!old) throw new Error('Expected claimed job')
    await pool.query(
      "update redaction_runs set detection_lease_until = now() - interval '1 second' where id = $1",
      [id],
    )
    const reclaimed = await claimDetectionJob(pool)
    if (!reclaimed) throw new Error('Expected expired job')
    expect(reclaimed.id).toBe(id)
    expect(reclaimed.detection_lease_token).not.toBe(old.detection_lease_token)
    await processDetectionJob(pool, f.storage, old, { detect: detector })
    expect((await f.read(id)).status).toBe('detecting')
    await pool.query(
      "update redaction_runs set detection_attempts = 3, detection_lease_until = now() - interval '1 second' where id = $1",
      [id],
    )
    const exhausted = await claimDetectionJob(pool)
    if (!exhausted) throw new Error('Expected exhausted job')
    await processDetectionJob(pool, f.storage, exhausted, { detect: detector })
    const failed = await f.read(id)
    expect(failed.status).toBe('failed')
    expect(failed.summary.failureReason).toContain('repeatedly')
  } finally {
    await f.cleanup()
  }
})

it('reports that a scanned PDF requires OCR after the request has already returned', async () => {
  const f = await fixture()
  try {
    const form = new FormData()
    const bytes = await readFile(
      '../../data/evals/redact/pdf-scanned-like-fixture.pdf',
    )
    form.set(
      'file',
      new File([bytes], 'synthetic-scanned.pdf', { type: 'application/pdf' }),
    )
    const response = await f
      .app()
      .request('/api/redaction-runs', { method: 'POST', body: form })
    expect(response.status).toBe(202)
    const queued = await readRun(response)
    const job = await claimDetectionJob(pool)
    if (!job) throw new Error('Expected queued job')
    expect(job.id).toBe(queued.id)
    await processDetectionJob(pool, f.storage, job, {
      detect: async () => {
        throw new Error('Unreadable sources must not reach inference')
      },
    })
    const failed = await f.read(queued.id)
    expect(failed.status).toBe('failed')
    expect(failed.summary.failureReason).toContain('OCR')
    expect(f.storage.binary.has(job.detection_input_key)).toBe(true)
  } finally {
    await f.cleanup()
  }
})

it('lets a second upload progress while a long document is still detecting on one worker', async () => {
  const f = await fixture()
  try {
    const longText = 'Email synthetic.person@example.com. '.repeat(7_000)
    const shortText = 'Email synthetic.person@example.com'
    const longId = await f.create(longText)
    const shortId = await f.create(shortText)
    let releaseLong: () => void = () => undefined
    const longPaused = new Promise<void>((resolve) => {
      releaseLong = resolve
    })
    const started: string[] = []
    const worker = startDetectionWorker(pool, f.storage, {
      detect: async (text, progress) => {
        const isLong = text === longText
        started.push(isLong ? 'long' : 'short')
        if (isLong) await longPaused
        return detector(text, progress)
      },
    })
    const deadline = Date.now() + 15_000
    while (
      (await f.read(shortId)).status !== 'ready_for_review' &&
      Date.now() < deadline
    )
      await sleep(100)
    expect((await f.read(shortId)).status).toBe('ready_for_review')
    expect((await f.read(longId)).status).toBe('detecting')
    releaseLong()
    while (
      (await f.read(longId)).status === 'detecting' &&
      Date.now() < deadline
    )
      await sleep(100)
    expect((await f.read(longId)).status).toBe('ready_for_review')
    await worker.stop()
    expect(started).toEqual(['long', 'short'])
  } finally {
    await f.cleanup()
  }
})

it('releases its lease after a window when graceful shutdown begins', async () => {
  const f = await fixture()
  try {
    const id = await f.create()
    const job = await claimDetectionJob(pool)
    if (!job) throw new Error('Expected queued job')
    await processDetectionJob(pool, f.storage, job, {
      stopping: () => true,
      detect: detector,
    })
    const next = await claimDetectionJob(pool)
    expect(next?.id).toBe(id)
    expect(next?.detection_attempts).toBe(1)
  } finally {
    await f.cleanup()
  }
})
