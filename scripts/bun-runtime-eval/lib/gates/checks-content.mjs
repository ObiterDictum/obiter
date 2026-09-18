/* Content gates: verification, native inference, streaming, database. */
import { request as httpRequest } from 'node:http'
import { performance } from 'node:perf_hooks'
import { setTimeout as sleep } from 'node:timers/promises'
import { DOCX_CONTENT_TYPE } from '../../../load/fixtures.mjs'
import { bearer, group, json, record } from './harness.mjs'

export async function checkVerification({ origin, ids, querier }) {
  // ---- verification execution
  group('verification')

  const readyDoc = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select d.id as document_id, v.id as version_id
      from matter_documents d
      join document_versions v on v.id = d.current_version_id
      where d.matter_id = '${ids.matterId}' and v.document_status = 'ready'
      order by v.created_at desc limit 1
    ) r`)
  if (readyDoc.length > 0) {
    const verification = await fetch(
      `${origin}/api/documents/${readyDoc[0].document_id}/verification-runs`,
      json({ versionId: readyDoc[0].version_id }, ids.sessionToken),
    )
    const verificationBody = await verification.json().catch(() => null)
    record(
      'verification run executes and returns a run',
      verification.status === 201 &&
        typeof verificationBody?.run?.id === 'string',
      `status=${verification.status} run=${verificationBody?.run?.id ?? 'none'}`,
    )
    if (verificationBody?.run?.id) {
      const findings = await fetch(
        `${origin}/api/verification-runs/${verificationBody.run.id}/findings`,
        { headers: bearer(ids.sessionToken) },
      )
      const findingsBody = await findings.json().catch(() => null)
      record(
        'verification findings are readable',
        findings.status === 200 && Array.isArray(findingsBody?.findings),
        `status=${findings.status} findings=${findingsBody?.findings?.length ?? 'none'}`,
      )
    }
  } else {
    record(
      'verification run executes and returns a run',
      false,
      'no ready document to verify',
    )
  }
}

export async function checkNativeInference({ origin, ids, runTag }) {
  // ---- native inference
  group('native inference')

  const inferenceText = Array.from(
    { length: 60 },
    (_, index) =>
      `Clause ${index + 1}. The parties acknowledge that Acme Holdings Limited, ` +
      `registered at 14 Fenchurch Street, London, and its director Ms Jane Whitfield ` +
      `(jane.whitfield@example.test, +44 7700 900123) shall keep the terms of this ` +
      `agreement confidential.`,
  ).join(' ')
  const inference = await fetch(
    `${origin}/api/redaction-runs`,
    json(
      {
        filename: `gate-${runTag}.txt`,
        text: inferenceText,
        policyMode: 'internal_ai_minimisation',
      },
      ids.sessionToken,
    ),
  )
  const inferenceBody = await inference.json().catch(() => null)
  const detectionMode = inferenceBody?.run?.detectionMode ?? null
  const spans =
    inferenceBody?.run?.spans?.length ?? inferenceBody?.spans?.length ?? 0
  record(
    'ONNX detection runs and reports model+supplement',
    inference.status === 201 &&
      detectionMode === 'model+supplement' &&
      spans > 0,
    `status=${inference.status} detectionMode=${detectionMode} spans=${spans}`,
  )

  const runId = inferenceBody?.run?.id
  if (runId) {
    // A text-only run has no layout artifact; the route must say 404 rather
    // than 500 or an empty body.
    const layout = await fetch(`${origin}/api/redaction-runs/${runId}/layout`, {
      headers: bearer(ids.sessionToken),
    })
    record(
      'text-only redaction run reports no layout as 404',
      layout.status === 404,
      `status=${layout.status}`,
    )
  }
}

export async function checkStreaming({
  origin,
  port,
  ids,
  fixtures,
  querier,
  state,
}) {
  const small = fixtures.find((entry) => entry.size === 'small')
  const uploadedDocumentId = state.lastUploadedDocumentId
  // ---- streaming and backpressure
  group('streaming')

  if (uploadedDocumentId) {
    const slow = await new Promise((done) => {
      const started = performance.now()
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/api/documents/${uploadedDocumentId}/download`,
          headers: bearer(ids.sessionToken),
        },
        (response) => {
          let bytes = 0
          let paused = 0
          response.on('data', (chunk) => {
            bytes += chunk.length
            paused += 1
            response.pause()
            setTimeout(() => response.resume(), 30)
          })
          response.on('end', () =>
            done({
              status: response.statusCode,
              bytes,
              paused,
              ms: performance.now() - started,
            }),
          )
        },
      )
      request.on('error', (error) =>
        done({ status: 0, bytes: 0, error: error.message }),
      )
      request.end()
    })
    record(
      'slow reader receives the whole body (backpressure does not truncate)',
      slow.status === 200 && slow.bytes === small.bytes,
      `status=${slow.status} bytes=${slow.bytes} expected=${small.bytes} pauses=${slow.paused} ms=${Math.round(slow.ms)}`,
    )
  }

  // Client disconnect mid-download: the server must not crash and must keep
  // serving. The document is the medium fixture, big enough that the body is
  // still in flight when the socket is destroyed.
  const mediumDoc = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select d.id as document_id
      from matter_documents d join document_versions v on v.id = d.current_version_id
      where d.matter_id = '${ids.matterId}' and v.document_status = 'ready' and v.size_bytes > 100000
      order by v.size_bytes desc limit 1
    ) r`)
  const disconnectTarget = mediumDoc[0]?.document_id ?? uploadedDocumentId
  if (disconnectTarget) {
    await new Promise((done) => {
      const request = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: `/api/documents/${disconnectTarget}/download`,
          headers: bearer(ids.sessionToken),
        },
        (response) => {
          response.once('data', () => {
            request.destroy()
            done()
          })
          response.on('error', () => done())
        },
      )
      request.on('error', () => done())
      request.end()
    })
    await sleep(500)
    const afterDisconnect = await fetch(`${origin}/api/health`)
    record(
      'server survives a client disconnect mid-download',
      afterDisconnect.status === 200,
      `health after abort=${afterDisconnect.status}`,
    )
  }
}

export async function checkDatabase({ origin, ids, querier, runTag }) {
  // ---- concurrent database transactions and rollback
  group('database')

  const matterCreates = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      fetch(
        `${origin}/api/matters`,
        json(
          {
            name: `gate-concurrent-${runTag}-${index}`,
            primaryJurisdiction: 'england_and_wales',
          },
          ids.sessionToken,
        ),
      ).then(async (response) => ({
        status: response.status,
        body: await response.json().catch(() => null),
      })),
    ),
  )
  record(
    'six concurrent matter creates all commit',
    matterCreates.every((entry) => entry.status === 201),
    `statuses=${matterCreates.map((entry) => entry.status).join(',')}`,
  )
  const createdIds = matterCreates
    .map((entry) => entry.body?.matter?.id)
    .filter(Boolean)
  const rowsAfter = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from matters
      where organisation_id = '${ids.organisationId}' and name like 'gate-concurrent-${runTag}-%'
    ) r`)
  record(
    'every committed create is visible in Postgres (no lost write)',
    rowsAfter[0]?.count === createdIds.length,
    `api=${createdIds.length} database=${rowsAfter[0]?.count}`,
  )

  // A failed request must leave no partial row. An invalid matter name is
  // refused by validation before any write; a failed extraction must roll back
  // the document/version/audit triple.
  const before = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from audit_logs where organisation_id = '${ids.organisationId}'
    ) r`)
  const rejected = await fetch(
    `${origin}/api/matters`,
    json(
      { name: '', primaryJurisdiction: 'england_and_wales' },
      ids.sessionToken,
    ),
  )
  const after = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from audit_logs where organisation_id = '${ids.organisationId}'
    ) r`)
  record(
    'a rejected write commits nothing (audit count unchanged)',
    rejected.status === 400 && before[0].count === after[0].count,
    `status=${rejected.status} auditBefore=${before[0].count} auditAfter=${after[0].count}`,
  )

  const badUploadBefore = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from matter_documents where matter_id = '${ids.matterId}'
    ) r`)
  const badUpload = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    {
      method: 'POST',
      headers: bearer(ids.sessionToken),
      body: (() => {
        const form = new FormData()
        form.set('filename', 'gate-invalid.docx')
        form.set('fileType', 'docx')
        form.set('sizeBytes', '100')
        form.set('contentSha256', 'not-a-sha')
        form.set(
          'file',
          new File([Buffer.from('not a zip at all')], 'gate-invalid.docx', {
            type: DOCX_CONTENT_TYPE,
          }),
        )
        return form
      })(),
    },
  )
  const badUploadAfter = querier.rows(`
    select coalesce(json_agg(row_to_json(r)), '[]'::json)::text from (
      select count(*)::int as count from matter_documents where matter_id = '${ids.matterId}'
    ) r`)
  record(
    'a failed extraction leaves no document row behind',
    badUpload.status >= 400 &&
      badUploadBefore[0].count === badUploadAfter[0].count,
    `status=${badUpload.status} before=${badUploadBefore[0].count} after=${badUploadAfter[0].count}`,
  )
}
