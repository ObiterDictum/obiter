import { setTimeout as sleep } from 'node:timers/promises'

import { bearer, multipartBody } from '../api-runtime/http.mjs'
import {
  API_HOST,
  CONTROL_UPLOAD_BYTES,
  LONG_STREAM_QUERY,
  ORIGIN_HOST,
  SLOW_UPLOAD_BYTES,
  STREAM_TOTAL_BYTES,
  sha256,
} from './proxy.mjs'

const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function parseJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8') || 'null')
  } catch {
    return null
  }
}

async function uploadDocument({
  proxy,
  port,
  ids,
  filename,
  fileType,
  contentType,
  content,
}) {
  const boundary = `----obiteringress${filename.replace(/\W/g, '')}${Date.now()}`
  const body = multipartBody({
    boundary,
    fields: {
      filename,
      fileType,
      sizeBytes: String(content.byteLength),
      contentSha256: sha256(content),
    },
    file: { filename, contentType, content },
  })
  const response = await proxy.apiRequest({
    port,
    path: `/api/matters/${ids.matterId}/documents`,
    method: 'POST',
    token: ids.sessionToken,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.byteLength),
    },
    body,
    timeoutMs: 120_000,
  })
  return { status: response.status, parsed: parseJson(response.body) }
}

export async function runThroughProxyChecks(ctx) {
  const { report, proxy, lifecycle, traefikPort, ids, docx, largeText } = ctx

  report.group('Bun through the proxy')
  const health = await proxy.waitForRuntime(traefikPort, 'bun', 120_000)
  report.record(
    '/api/health answers through Traefik and names the Bun adapter',
    health.status === 200 && health.runtime === 'bun',
    `status=${health.status} runtime=${health.runtime}`,
  )

  await ctx.provisionFixtures()

  const me = await proxy.apiRequest({
    port: traefikPort,
    path: '/api/me',
    token: ids.sessionToken,
  })
  const meBody = parseJson(me.body)
  report.record(
    'an authenticated /api/me succeeds through Traefik',
    me.status === 200 &&
      meBody?.user?.id === ids.userId &&
      meBody?.organisation?.id === ids.organisationId,
    `status=${me.status} user=${meBody?.user?.id ?? 'none'}`,
  )
  const anonymous = await proxy.apiRequest({
    port: traefikPort,
    path: '/api/me',
  })
  report.record(
    'an anonymous /api/me is refused through Traefik',
    anonymous.status === 401,
    `status=${anonymous.status}`,
  )

  const upload = await uploadDocument({
    proxy,
    port: traefikPort,
    ids,
    filename: 'letter-plain.docx',
    fileType: 'docx',
    contentType: DOCX_CONTENT_TYPE,
    content: docx,
  })
  const documentId = upload.parsed?.document?.id ?? null
  report.record(
    'a real DOCX uploads and reaches ready through Traefik',
    upload.status === 201 && upload.parsed?.version?.documentStatus === 'ready',
    `status=${upload.status} documentStatus=${upload.parsed?.version?.documentStatus ?? 'none'}`,
  )

  if (documentId) {
    const download = await proxy.readSlowly({
      port: traefikPort,
      path: `/api/documents/${documentId}/download`,
      token: ids.sessionToken,
      pauseMs: 25,
    })
    report.record(
      'a slow reader downloads the byte-identical DOCX through Traefik',
      download.status === 200 &&
        download.bytes === docx.byteLength &&
        download.sha256 === sha256(docx),
      `status=${download.status} bytes=${download.bytes} expected=${docx.byteLength} pauses=${download.chunks}`,
    )
  }

  const largeUpload = await uploadDocument({
    proxy,
    port: traefikPort,
    ids,
    filename: 'ingress-load.txt',
    fileType: 'txt',
    contentType: 'text/plain',
    content: largeText,
  })
  const largeDocumentId = largeUpload.parsed?.document?.id ?? null
  report.record(
    'a multi-MiB text document uploads and reaches ready through Traefik',
    largeUpload.status === 201 &&
      largeUpload.parsed?.version?.documentStatus === 'ready',
    `status=${largeUpload.status} bytes=${largeText.byteLength} documentStatus=${largeUpload.parsed?.version?.documentStatus ?? 'none'}`,
  )

  if (largeDocumentId) {
    const largeDownload = await proxy.readSlowly({
      port: traefikPort,
      path: `/api/documents/${largeDocumentId}/download`,
      token: ids.sessionToken,
      pauseMs: 8,
    })
    report.record(
      'a multi-MiB download is byte-identical and backpressured through Traefik',
      largeDownload.status === 200 &&
        largeDownload.bytes === largeText.byteLength &&
        largeDownload.sha256 === sha256(largeText) &&
        largeDownload.chunks > 1,
      `status=${largeDownload.status} bytes=${largeDownload.bytes} expected=${largeText.byteLength} pauses=${largeDownload.chunks}`,
    )
  }

  report.group('proxy request limits (shipped config)')
  const smallHeader = await proxy.headerProbe({
    port: traefikPort,
    host: ORIGIN_HOST,
    headerBytes: 4096,
  })
  report.record(
    'a 4 KiB header reaches the origin',
    smallHeader.status === 200,
    `status=${smallHeader.status}`,
  )
  const hugeHeader = await proxy.headerProbe({
    port: traefikPort,
    host: ORIGIN_HOST,
    headerBytes: 64 * 1024,
  })
  report.record(
    'a 64 KiB header is refused by the proxy',
    hugeHeader.status === 431,
    `status=${hugeHeader.status}`,
  )

  const slowUpload = await proxy.pacedUpload({
    port: traefikPort,
    host: ORIGIN_HOST,
    path: '/upload',
    totalBytes: SLOW_UPLOAD_BYTES,
  })
  report.record(
    'a 25 MiB upload at ~640 KiB/s completes inside readTimeout',
    slowUpload.complete && slowUpload.status === 201,
    `status=${slowUpload.status} sent=${slowUpload.sent}/${SLOW_UPLOAD_BYTES} elapsed=${slowUpload.elapsedMs}ms`,
  )

  const longStream = await proxy.readStream({
    port: traefikPort,
    host: ORIGIN_HOST,
    path: `/stream?${LONG_STREAM_QUERY}`,
  })
  report.record(
    'a ~10s download completes (writeTimeout disabled)',
    longStream.complete &&
      longStream.status === 200 &&
      longStream.bytes === STREAM_TOTAL_BYTES,
    `status=${longStream.status} bytes=${longStream.bytes} elapsed=${longStream.elapsedMs}ms`,
  )

  report.group('runtime rollback behind one proxy')
  await lifecycle.startNode()
  await lifecycle.switchBackend('api-node')
  const nodeHealth = await proxy.waitForRuntime(traefikPort, 'node', 120_000)
  report.record(
    'the route switches to the Node image and health names node',
    nodeHealth.status === 200 && nodeHealth.runtime === 'node',
    `status=${nodeHealth.status} runtime=${nodeHealth.runtime}`,
  )
  const nodeMe = await proxy.apiRequest({
    port: traefikPort,
    path: '/api/me',
    token: ids.sessionToken,
  })
  report.record(
    'the same session authenticates through the Node image',
    nodeMe.status === 200,
    `status=${nodeMe.status}`,
  )

  await lifecycle.switchBackend('api-bun')
  const backToBun = await proxy.waitForRuntime(traefikPort, 'bun', 60_000)
  report.record(
    'the route switches back to Bun and health names bun',
    backToBun.status === 200 && backToBun.runtime === 'bun',
    `status=${backToBun.status} runtime=${backToBun.runtime}`,
  )

  report.group('graceful shutdown')
  if (!largeDocumentId) {
    report.record(
      'an in-flight download completes through SIGTERM and the container exits 0',
      false,
      'no large document to stream through shutdown',
    )
  } else {
    const boundary = `----obiteringressshutdown${Date.now()}`
    const body = multipartBody({
      boundary,
      fields: {
        filename: 'ingress-shutdown.txt',
        fileType: 'txt',
        sizeBytes: String(largeText.byteLength),
        contentSha256: sha256(largeText),
      },
      file: {
        filename: 'ingress-shutdown.txt',
        contentType: 'text/plain',
        content: largeText,
      },
    })
    let latestSent = 0
    let signalled = false
    let sentAtSignal = 0
    let stillDraining = null
    const uploadPromise = proxy.pacedUpload({
      port: traefikPort,
      host: API_HOST,
      path: `/api/matters/${ids.matterId}/documents`,
      totalBytes: body.byteLength,
      body,
      intervalMs: 15,
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        ...bearer(ids.sessionToken),
      },
      onProgress: ({ sent }) => {
        latestSent = sent
      },
    })
    const signalTimer = setTimeout(() => {
      if (latestSent >= body.byteLength) return
      signalled = true
      sentAtSignal = latestSent
      console.log(
        `[shutdown] SIGTERM mid-upload: ${sentAtSignal}/${body.byteLength} bytes sent`,
      )
      lifecycle.signalBun()
      setTimeout(() => {
        stillDraining = lifecycle.bunRunning()
      }, 400)
    }, 1_200)
    const upload = await uploadPromise
    clearTimeout(signalTimer)
    console.log(
      `[shutdown] upload resolved status=${upload.status} complete=${upload.complete} sent=${latestSent}/${body.byteLength} body=${upload.responseBody.slice(0, 200)}`,
    )
    let exitCode = null
    if (signalled) {
      if (stillDraining === null) await sleep(600)
      await lifecycle.waitBunExit()
      exitCode = lifecycle.bunExitCode()
    }
    const logs = lifecycle.bunLogs()
    const parsed = parseJson(Buffer.from(upload.responseBody))
    report.record(
      'a SIGTERM mid-upload drains: the upload completes, the process exits 0',
      signalled &&
        upload.complete &&
        upload.status === 201 &&
        parsed?.version?.documentStatus === 'ready' &&
        sentAtSignal < body.byteLength &&
        stillDraining === true &&
        exitCode === 0,
      `status=${upload.status} sentAtSignal=${sentAtSignal}/${body.byteLength} stillDraining=${stillDraining} exit=${exitCode}`,
    )
    report.record(
      'the drain log reports at least one open connection and the closed pool',
      /draining with [1-9]\d* open connection/.test(logs) &&
        logs.includes('drained and database pool closed'),
      /draining with [1-9]\d* open connection/.test(logs)
        ? (logs.match(/draining with \d+ open connection\(s\)/)?.[0] ??
            'drain line present')
        : 'no in-flight connection reported at drain',
    )
  }

  return { documentId, largeDocumentId }
}

export async function runTimeoutControlChecks(ctx) {
  const { report, proxy, shortPort } = ctx
  report.group('timeout control (readTimeout/writeTimeout = 5s)')

  const cutUpload = await proxy.pacedUpload({
    port: shortPort,
    host: ORIGIN_HOST,
    path: '/upload',
    totalBytes: CONTROL_UPLOAD_BYTES,
  })
  report.record(
    'an upload slower than readTimeout is cut at ~5s',
    !cutUpload.complete &&
      cutUpload.sent > 512 * 1024 &&
      cutUpload.sent < CONTROL_UPLOAD_BYTES &&
      cutUpload.elapsedMs >= 4_000 &&
      cutUpload.elapsedMs <= 8_000,
    `status=${cutUpload.status} sent=${cutUpload.sent}/${CONTROL_UPLOAD_BYTES} elapsed=${cutUpload.elapsedMs}ms complete=${cutUpload.complete}`,
  )

  const cutStream = await proxy.readStream({
    port: shortPort,
    host: ORIGIN_HOST,
    path: `/stream?${LONG_STREAM_QUERY}`,
  })
  report.record(
    'a download longer than writeTimeout is cut at ~5s',
    cutStream.bytes > 0 &&
      cutStream.bytes < STREAM_TOTAL_BYTES &&
      cutStream.elapsedMs >= 4_000 &&
      cutStream.elapsedMs <= 8_000,
    `status=${cutStream.status} bytes=${cutStream.bytes}/${STREAM_TOTAL_BYTES} elapsed=${cutStream.elapsedMs}ms complete=${cutStream.complete}`,
  )
}
