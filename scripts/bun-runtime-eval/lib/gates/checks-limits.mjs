/* Limit gates: request body limits, upload and extraction. */
import { createHash } from 'node:crypto'
import { DOCX_CONTENT_TYPE, fixtureFilename } from '../../../load/fixtures.mjs'
import {
  bearer,
  chunkedJsonPost,
  expectContinueUpload,
  group,
  json,
  makeZipBomb,
  multipartBody,
  rawRequest,
  record,
} from './harness.mjs'

export async function checkRequestLimits({
  origin,
  port,
  ids,
  fixtures,
  runTag,
}) {
  const small = fixtures.find((entry) => entry.size === 'small')
  // ---- request body limits
  group('request limits')

  const oversizedJson = await fetch(
    `${origin}/api/matters/${ids.matterId}/documents`,
    json(
      {
        filename: 'x',
        fileType: 'docx',
        contentSha256: 'a'.repeat(64),
        sizeBytes: 1,
        pad: 'z'.repeat(80_000),
      },
      ids.sessionToken,
    ),
  )
  record(
    'JSON body over 48 KiB is 413',
    oversizedJson.status === 413,
    `status=${oversizedJson.status} body=${(await oversizedJson.text()).slice(0, 80)}`,
  )

  const boundary = `----obitereval${Date.now()}`
  const oversizedMultipart = multipartBody({
    boundary,
    fields: { filename: 'big.docx', fileType: 'docx' },
    file: {
      filename: 'big.docx',
      contentType: DOCX_CONTENT_TYPE,
      // 27 MiB, above the API's 25 MiB multipart cap.
      content: Buffer.alloc(27 * 1024 * 1024, 0x41),
    },
  })
  const overUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(oversizedMultipart.byteLength),
    },
    body: oversizedMultipart,
    timeoutMs: 30_000,
  })
  const overUploadBody = overUpload.body.toString('utf8').slice(0, 200)
  record(
    'multipart upload over the 25 MiB cap is 413',
    overUpload.status === 413,
    `status=${overUpload.status} bytes=${oversizedMultipart.byteLength} body=${overUploadBody.slice(0, 100)}`,
  )

  const malformedBoundary = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': 'multipart/form-data; boundary=',
      'Content-Length': String(
        Buffer.byteLength('this is not multipart at all, honest!'),
      ),
    },
    body: Buffer.from('this is not multipart at all, honest!'),
  })
  record(
    'malformed multipart answers 4xx, not 500',
    malformedBoundary.status >= 400 && malformedBoundary.status < 500,
    `status=${malformedBoundary.status} body=${malformedBoundary.body.toString('utf8').slice(0, 120)}`,
  )

  const truncatedMultipart = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="filename"\r\n\r\n`,
    ),
  })
  record(
    'truncated multipart is rejected, not accepted as an empty document',
    truncatedMultipart.status >= 400 && truncatedMultipart.status < 500,
    `status=${truncatedMultipart.status} body=${truncatedMultipart.body.toString('utf8').slice(0, 120)}`,
  )

  // An oversized header is a transport-level limit, not an application one:
  // Node caps request headers at 16 KiB by default; Bun exposes no such knob.
  const hugeHeader = await rawRequest({
    port,
    path: '/api/health',
    headers: { 'X-Oversized': 'A'.repeat(64 * 1024) },
    timeoutMs: 10_000,
  })
  record(
    'an oversized request header is rejected or the connection closed',
    hugeHeader.status === 431 ||
      (hugeHeader.status >= 400 && hugeHeader.status < 500) ||
      hugeHeader.error !== undefined,
    `status=${hugeHeader.status} error=${hugeHeader.error ?? 'none'}`,
    {
      observed: { status: hugeHeader.status, error: hugeHeader.error ?? null },
    },
  )

  // Some clients (curl for large bodies) send Expect: 100-continue. Node's
  // http server has an explicit checkContinue path; Bun surfaces no API.
  const expectContinue = await expectContinueUpload({
    port,
    token: ids.sessionToken,
    matterId: ids.matterId,
    fixture: small,
  })
  record(
    'Expect: 100-continue upload is handled without hanging',
    expectContinue.status === 201,
    `interim=${expectContinue.interim} status=${expectContinue.status} ms=${Math.round(expectContinue.ms)}`,
    { observed: expectContinue },
  )

  // A chunked (no Content-Length) JSON body: Node's http server decodes
  // Transfer-Encoding, and the application's limit middleware must still see
  // and bound the streamed bytes.
  const chunked = await chunkedJsonPost({
    port,
    path: `/api/matters`,
    token: ids.sessionToken,
    payload: JSON.stringify({
      name: `gate-chunked-${runTag}`,
      primaryJurisdiction: 'england_and_wales',
    }),
  })
  record(
    'chunked (no Content-Length) request body is decoded',
    chunked.status === 201,
    `status=${chunked.status} chunked=${chunked.usedChunkedEncoding}`,
  )

  const chunkedOversized = await chunkedJsonPost({
    port,
    path: `/api/matters`,
    token: ids.sessionToken,
    payload: JSON.stringify({
      name: 'x'.repeat(70_000),
      primaryJurisdiction: 'england_and_wales',
    }),
  })
  record(
    'an oversized chunked body is refused with 413, not streamed forever',
    chunkedOversized.status === 413,
    `status=${chunkedOversized.status}`,
  )
}

export async function checkUploadAndExtraction({
  origin,
  port,
  ids,
  fixtures,
  state,
}) {
  const small = fixtures.find((entry) => entry.size === 'small')
  // ---- upload + extraction, happy path
  group('upload and extraction')

  const goodBoundary = `----obitereval${Date.now() + 1}`
  const goodMultipart = multipartBody({
    boundary: goodBoundary,
    fields: {
      filename: fixtureFilename(small),
      fileType: 'docx',
      sizeBytes: String(small.bytes),
      contentSha256: createHash('sha256').update(small.content).digest('hex'),
    },
    file: {
      filename: fixtureFilename(small),
      contentType: DOCX_CONTENT_TYPE,
      content: small.content,
    },
  })
  const goodUpload = await rawRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    headers: {
      ...bearer(ids.sessionToken),
      'Content-Type': `multipart/form-data; boundary=${goodBoundary}`,
      'Content-Length': String(goodMultipart.byteLength),
    },
    body: goodMultipart,
    timeoutMs: 30_000,
  })
  const goodUploadBody = JSON.parse(goodUpload.body.toString('utf8') || '{}')
  record(
    'genuine DOCX uploads, extracts inline and reaches ready',
    goodUpload.status === 201 &&
      goodUploadBody?.version?.documentStatus === 'ready',
    `status=${goodUpload.status} documentStatus=${goodUploadBody?.version?.documentStatus} versionNumber=${goodUploadBody?.version?.versionNumber}`,
  )
  const uploadedDocumentId = goodUploadBody?.document?.id ?? null
  const _uploadedVersionId = goodUploadBody?.version?.id ?? null
  if (uploadedDocumentId) state.lastUploadedDocumentId = uploadedDocumentId
  record(
    'extraction wrote a text object key for the ready version',
    typeof goodUploadBody?.version?.textObjectKey === 'string' &&
      goodUploadBody.version.textObjectKey.length > 0,
    `textObjectKey=${goodUploadBody?.version?.textObjectKey ?? 'none'}`,
  )

  if (uploadedDocumentId) {
    const editorModel = await fetch(
      `${origin}/api/documents/${uploadedDocumentId}/model`,
      {
        headers: bearer(ids.sessionToken),
      },
    )
    record(
      'extracted DOCX is readable through the editor model route',
      editorModel.status === 200,
      `status=${editorModel.status}`,
    )

    const download = await rawRequest({
      port,
      path: `/api/documents/${uploadedDocumentId}/download`,
      headers: bearer(ids.sessionToken),
    })
    record(
      'download returns the byte-identical uploaded DOCX',
      download.status === 200 &&
        download.body.byteLength === small.bytes &&
        createHash('sha256').update(download.body).digest('hex') ===
          createHash('sha256').update(small.content).digest('hex'),
      `status=${download.status} bytes=${download.body.byteLength} expected=${small.bytes}`,
    )
    record(
      'download sets content-disposition and content-length',
      /attachment/.test(download.headers['content-disposition'] ?? '') &&
        Number(download.headers['content-length']) === small.bytes,
      `disposition=${download.headers['content-disposition']} length=${download.headers['content-length']}`,
    )

    // A DOCX whose ZIP is a bomb is refused by the ooxml limits, not extracted.
    const bombBoundary = `----obiterevalbomb${Date.now()}`
    const bomb = makeZipBomb()
    const bombMultipart = multipartBody({
      boundary: bombBoundary,
      fields: {
        filename: 'bomb.docx',
        fileType: 'docx',
        sizeBytes: String(bomb.byteLength),
      },
      file: {
        filename: 'bomb.docx',
        contentType: DOCX_CONTENT_TYPE,
        content: bomb,
      },
    })
    const bombUpload = await rawRequest({
      port,
      path: `/api/matters/${ids.matterId}/documents`,
      method: 'POST',
      headers: {
        ...bearer(ids.sessionToken),
        'Content-Type': `multipart/form-data; boundary=${bombBoundary}`,
        'Content-Length': String(bombMultipart.byteLength),
      },
      body: bombMultipart,
      timeoutMs: 30_000,
    })
    record(
      'compression-ratio-bomb DOCX is refused (4xx/413), not extracted',
      bombUpload.status >= 400 && bombUpload.status < 500,
      `status=${bombUpload.status} bytes=${bomb.byteLength}`,
    )
  }
}
