/*
 * The graceful-shutdown check, which ends the server it inspects.
 *
 * A real download is left in flight, SIGTERM is delivered, and the in-flight
 * response must still complete with its whole body before the process exits 0
 * and releases the port. Runs last for a runtime because it stops the server.
 */
import { request as httpRequest } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { logText, portIsReleased, signalAndWait } from './lifecycle.mjs'

export async function runShutdownCheck({
  server,
  ids,
  uploadedDocumentId,
  recorder,
  expectedBytes,
}) {
  recorder.group('graceful shutdown')
  if (!uploadedDocumentId) {
    recorder.record(
      'an in-flight request completes through SIGTERM',
      false,
      'no uploaded document to stream through shutdown',
    )
    return
  }

  let received = 0
  let status = 0
  const slow = new Promise((resolve) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: server.port,
        path: `/api/documents/${uploadedDocumentId}/download`,
        headers: { Authorization: `Bearer ${ids.sessionToken}` },
      },
      (response) => {
        status = response.statusCode
        response.on('data', (chunk) => {
          received += chunk.length
          response.pause()
          setTimeout(() => response.resume(), 120)
        })
        response.on('end', () => resolve())
      },
    )
    request.on('error', () => resolve())
    request.end()
  })

  await sleep(300)
  const signalledAt = Date.now()
  const exit = await signalAndWait(server, 'SIGTERM', 12_000)
  await slow
  const drainedMs = Date.now() - signalledAt
  const released = await portIsReleased(server.port)

  recorder.record(
    'an in-flight download completes through SIGTERM',
    status === 200 && received === expectedBytes,
    `status=${status} bytes=${received} expected=${expectedBytes} closed ${drainedMs}ms after signal`,
  )
  recorder.record(
    'the process exits 0 after draining',
    exit?.code === 0,
    `exitCode=${exit?.code ?? 'none'} signal=${exit?.signal ?? 'none'}`,
  )
  recorder.record(
    'the drain log reports the database pool closed',
    logText(server).includes('drained and database pool closed'),
    'shutdown line present',
  )
  recorder.record(
    'the port is released after exit',
    released,
    `listener released=${released}`,
  )
}
