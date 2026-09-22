/*
 * Transaction, streaming, verification and inference checks for one runtime.
 *
 * These are the behaviours a socket-layer change could quietly break: a write
 * that stops being atomic, a stream that stops draining, a model that silently
 * degrades to heuristics. No timing threshold is asserted.
 */
import { createHash } from 'node:crypto'
import { Agent, request as httpRequest } from 'node:http'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { fixtureFilename } from '../load/fixtures.mjs'
import {
  DOCX_CONTENT_TYPE,
  bearer,
  getJson,
  jsonInit,
  multipartBody,
  rawRequest,
} from './http.mjs'
import {
  auditActionsSql,
  auditCountSql,
  documentCountSql,
  matterCountSql,
  readyDocumentSql,
} from './fixtures.mjs'

/** A distinctive string in the inference body; it must never reach the logs. */
const INFERENCE_MARKER = 'obiter-inference-marker-do-not-log'

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function checkDatabaseTransactions(ctx) {
  const { origin, ids, recorder, querier, runTag } = ctx
  recorder.group('database')

  const creates = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      fetch(`${origin}/api/matters`, {
        ...jsonInit(
          {
            name: `apirt-concurrent-${runTag}-${index}`,
            primaryJurisdiction: 'england_and_wales',
          },
          ids.sessionToken,
        ),
        signal: AbortSignal.timeout(20_000),
      }).then((response) => response.status),
    ),
  )
  const committed = querier.rows(
    matterCountSql(ids.organisationId, `apirt-concurrent-${runTag}-`),
  )[0].count
  recorder.record(
    'six concurrent matter creates all commit, and Postgres sees all six',
    creates.every((status) => status === 201) && committed === 6,
    `statuses=${creates.join(',')} databaseRows=${committed}`,
  )

  const auditBefore = querier.rows(auditCountSql(ids.organisationId))[0].count
  const rejected = await fetch(`${origin}/api/matters`, {
    ...jsonInit(
      { name: '', primaryJurisdiction: 'england_and_wales' },
      ids.sessionToken,
    ),
    signal: AbortSignal.timeout(20_000),
  })
  const auditAfter = querier.rows(auditCountSql(ids.organisationId))[0].count
  recorder.record(
    'a rejected write commits nothing',
    rejected.status === 400 && auditBefore === auditAfter,
    `status=${rejected.status} auditBefore=${auditBefore} auditAfter=${auditAfter}`,
  )

  const documentsBefore = querier.rows(documentCountSql(ids.matterId))[0].count
  const form = new FormData()
  form.set('filename', 'apirt-invalid.docx')
  form.set('fileType', 'docx')
  form.set('sizeBytes', '100')
  form.set('contentSha256', 'not-a-sha')
  form.set(
    'file',
    new File([Buffer.from('not a zip at all')], 'apirt-invalid.docx', {
      type: DOCX_CONTENT_TYPE,
    }),
  )
  const badUpload = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    {
      method: 'POST',
      headers: bearer(ids.sessionToken),
      body: form,
      signal: AbortSignal.timeout(30_000),
    },
  )
  const documentsAfter = querier.rows(documentCountSql(ids.matterId))[0].count
  recorder.record(
    'a failed upload leaves no document row behind',
    badUpload.status >= 400 && documentsBefore === documentsAfter,
    `status=${badUpload.status} before=${documentsBefore} after=${documentsAfter}`,
  )
}

async function uploadFixture(ctx, fixture) {
  const boundary = `----obiterapi${Date.now()}${Math.random().toString(16).slice(2, 8)}`
  const body = multipartBody({
    boundary,
    fields: {
      filename: fixtureFilename(fixture),
      fileType: 'docx',
      sizeBytes: String(fixture.bytes),
      contentSha256: sha256(fixture.content),
    },
    file: {
      filename: fixtureFilename(fixture),
      contentType: DOCX_CONTENT_TYPE,
      content: fixture.content,
    },
  })
  const response = await rawRequest({
    port: ctx.port,
    path: `/api/matters/${ctx.ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ctx.ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.byteLength),
    },
    body,
    timeoutMs: 60_000,
  })
  return {
    status: response.status,
    parsed: JSON.parse(response.body.toString('utf8') || '{}'),
  }
}

async function checkUploadAndStreaming(ctx) {
  const { origin, port, ids, recorder, querier, fixtures } = ctx
  recorder.group('upload, extraction and streaming')

  const fixture =
    fixtures.find((entry) => entry.size === 'medium') ?? fixtures[0]
  const upload = await uploadFixture(ctx, fixture)
  const documentId = upload.parsed?.document?.id ?? null
  recorder.record(
    'a genuine DOCX uploads, extracts inline and reaches ready',
    upload.status === 201 && upload.parsed?.version?.documentStatus === 'ready',
    `status=${upload.status} documentStatus=${upload.parsed?.version?.documentStatus ?? 'none'}`,
  )
  ctx.uploadedDocumentId = documentId

  if (!documentId) return

  const actions = querier
    .rows(auditActionsSql(ids.organisationId))
    .map((row) => row.action)
  recorder.record(
    'the upload transaction wrote its document and version audit rows',
    actions.includes('document.upload') &&
      actions.includes('document.version_create'),
    `document.upload=${actions.filter((a) => a === 'document.upload').length} version_create=${actions.filter((a) => a === 'document.version_create').length}`,
  )

  const download = await rawRequest({
    port,
    path: `/api/documents/${documentId}/download`,
    headers: bearer(ids.sessionToken),
  })
  recorder.record(
    'download returns the byte-identical uploaded DOCX',
    download.status === 200 &&
      sha256(download.body) === sha256(fixture.content) &&
      /attachment/.test(download.headers['content-disposition'] ?? '') &&
      Number(download.headers['content-length']) === fixture.bytes,
    `status=${download.status} bytes=${download.body.byteLength} expected=${fixture.bytes}`,
  )

  const slow = await readSlowly({
    port,
    path: `/api/documents/${documentId}/download`,
    headers: bearer(ids.sessionToken),
    pauseMs: 25,
  })
  recorder.record(
    'a slow reader receives the whole body (backpressure does not truncate)',
    slow.status === 200 && slow.bytes === fixture.bytes && slow.pauses > 0,
    `status=${slow.status} bytes=${slow.bytes} pauses=${slow.pauses} ms=${Math.round(slow.ms)}`,
  )

  await abortMidDownload({
    port,
    path: `/api/documents/${documentId}/download`,
    headers: bearer(ids.sessionToken),
  })
  await sleep(300)
  const afterAbort = await getJson(`${origin}/api/health`)
  recorder.record(
    'the server survives a client disconnect mid-download',
    afterAbort.status === 200,
    `health after abort=${afterAbort.status}`,
  )
}

/** Read a response with pauses, so socket backpressure must drain, not drop. */
function readSlowly({ port, path, headers, pauseMs }) {
  return new Promise((resolve) => {
    const started = performance.now()
    let bytes = 0
    let pauses = 0
    const request = httpRequest(
      { host: '127.0.0.1', port, path, headers },
      (response) => {
        response.on('data', (chunk) => {
          bytes += chunk.length
          pauses += 1
          response.pause()
          setTimeout(() => response.resume(), pauseMs)
        })
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            bytes,
            pauses,
            ms: performance.now() - started,
          }),
        )
      },
    )
    request.on('error', () =>
      resolve({ status: 0, bytes, pauses, ms: performance.now() - started }),
    )
    request.end()
  })
}

/** Destroy the socket after the first body byte; the server must not crash. */
function abortMidDownload({ port, path, headers }) {
  return new Promise((resolve) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, headers },
      (response) => {
        response.once('data', () => {
          request.destroy()
          resolve()
        })
        response.on('error', () => resolve())
      },
    )
    request.on('error', () => resolve())
    request.end()
  })
}

async function checkKeepAlive(ctx) {
  const { port, ids, recorder } = ctx
  recorder.group('keep-alive')
  const agent = new Agent({ keepAlive: true, maxSockets: 2 })
  const statuses = await Promise.all(
    Array.from(
      { length: 12 },
      () =>
        new Promise((resolve) => {
          const request = httpRequest(
            {
              host: '127.0.0.1',
              port,
              path: '/api/matters',
              headers: bearer(ids.sessionToken),
              agent,
            },
            (response) => {
              response.resume()
              response.on('end', () => resolve(response.statusCode))
            },
          )
          request.on('error', () => resolve(0))
          request.end()
        }),
    ),
  )
  const sockets = agent.totalSocketCount
  agent.destroy()
  recorder.record(
    'keep-alive reuses sockets across 12 authenticated requests',
    statuses.every((status) => status === 200) && sockets <= 2,
    `statuses=${[...new Set(statuses)].join(',')} sockets=${sockets}`,
  )
}

async function checkVerification(ctx) {
  const { origin, recorder, querier, ids } = ctx
  recorder.group('verification')
  const ready = querier.rows(readyDocumentSql(ids.matterId))
  if (ready.length === 0) {
    recorder.record(
      'a verification run executes over a ready document',
      false,
      'no ready document to verify',
    )
    return
  }
  const response = await fetch(
    `${origin}/api/documents/${ready[0].document_id}/verification-runs`,
    {
      ...jsonInit({ versionId: ready[0].version_id }, ids.sessionToken),
      signal: AbortSignal.timeout(30_000),
    },
  )
  const body = await response.json().catch(() => null)
  recorder.record(
    'a verification run executes and returns a run',
    response.status === 201 && typeof body?.run?.id === 'string',
    `status=${response.status} run=${body?.run?.id ?? 'none'}`,
  )
  if (body?.run?.id) {
    const findings = await getJson(
      `${origin}/api/verification-runs/${body.run.id}/findings`,
      ids.sessionToken,
    )
    recorder.record(
      'verification findings are readable',
      findings.status === 200 && Array.isArray(findings.body?.findings),
      `status=${findings.status} findings=${findings.body?.findings?.length ?? 'none'}`,
    )
  }
}

async function checkInference(ctx) {
  const { origin, recorder, ids, runTag, server } = ctx
  recorder.group('native inference')
  const text = Array.from(
    { length: 40 },
    (_, index) =>
      `${INFERENCE_MARKER} Clause ${index + 1}. Acme Holdings Limited, registered at ` +
      `14 Fenchurch Street, London, and its director Ms Jane Whitfield ` +
      `(jane.whitfield@example.test, +44 7700 900123) keep this agreement confidential.`,
  ).join(' ')
  const response = await fetch(`${origin}/api/redaction-runs`, {
    ...jsonInit(
      {
        filename: `apirt-${runTag}.txt`,
        text,
        policyMode: 'internal_ai_minimisation',
      },
      ids.sessionToken,
    ),
    signal: AbortSignal.timeout(60_000),
  })
  const body = await response.json().catch(() => null)
  const spans = body?.run?.spans?.length ?? 0
  recorder.record(
    'native ONNX detection runs and reports model+supplement',
    response.status === 201 &&
      body?.run?.detectionMode === 'model+supplement' &&
      spans > 0,
    `status=${response.status} detectionMode=${body?.run?.detectionMode ?? 'none'} spans=${spans}`,
  )

  // Checked here rather than earlier so the submitted body has actually been
  // through the server before the logs are read.
  const logged = server.lines.map((entry) => entry.line).join('\n')
  recorder.record(
    'no submitted document text reaches the logs',
    !logged.includes(INFERENCE_MARKER),
    `submittedTextInLog=${logged.includes(INFERENCE_MARKER)}`,
  )
}

async function checkSearchRoutes(ctx) {
  const { origin, recorder } = ctx
  recorder.group('search routes')

  // Public by product policy (no session), bounded timeout, live probe of both
  // product indexes. The response may report ready/empty/missing/unreachable;
  // what must hold is the 200 envelope with no database or credential detail.
  const readiness = await getJson(`${origin}/api/search/readiness`)
  const readinessText = JSON.stringify(readiness.body ?? null)
  recorder.record(
    'readiness probes the index without leaking connection details',
    readiness.status === 200 &&
      typeof readiness.body?.index === 'string' &&
      !readinessText.includes('postgres://') &&
      !readinessText.includes('harness-meili'),
    `status=${readiness.status} index=${readiness.body?.index ?? 'none'} statusValue=${readiness.body?.status ?? 'none'}`,
    { readinessStatus: readiness.body?.status ?? null },
  )

  // Anonymous fetch is stored-only by product policy: it must not queue
  // hydration or call the provider, so this can never write the corpus or the
  // index. 200 with the fetch envelope when the index answers; the documented
  // 503 search_unavailable when it does not (the harness runs with placeholder
  // keys against whatever engine is local, and CI's Bun job has no engine).
  // The observed status is recorded for the cross-runtime parity comparison.
  const fetchSearch = await fetch(`${origin}/api/search/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'R (2021) UKSC 1' }),
    signal: AbortSignal.timeout(20_000),
  })
  const fetchBody = await fetchSearch.json().catch(() => null)
  const contract =
    fetchSearch.status === 200 ||
    (fetchSearch.status === 503 &&
      fetchBody?.error?.code === 'search_unavailable')
  recorder.record(
    'an anonymous search fetch answers the contract',
    contract,
    `status=${fetchSearch.status} code=${fetchBody?.error?.code ?? 'none'}`,
    { searchFetchStatus: fetchSearch.status },
  )
}

export async function runBehaviourChecks(ctx) {
  await checkDatabaseTransactions(ctx)
  await checkUploadAndStreaming(ctx)
  await checkKeepAlive(ctx)
  await checkVerification(ctx)
  await checkSearchRoutes(ctx)
  await checkInference(ctx)
  return ctx.recorder.results
}
