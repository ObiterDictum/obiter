/*
 * HTTP helpers for the runtime harness.
 *
 * `rawRequest` writes bytes and headers directly over `node:http` so a check can
 * declare an exact `Content-Length`, send a malformed boundary, or truncate a
 * multipart body — the request shapes that must not be built out of `fetch`,
 * which would normalise them.
 */
import { request as httpRequest } from 'node:http'
import { createRequire } from 'node:module'
import { join } from 'node:path'

export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function bearer(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function jsonInit(body, token) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...bearer(token) },
    body: JSON.stringify(body),
  }
}

export async function getJson(url, token) {
  const response = await fetch(url, {
    headers: bearer(token),
    signal: AbortSignal.timeout(20_000),
  })
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  }
}

export function rawRequest({
  port,
  path,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 30_000,
}) {
  return new Promise((resolve) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method, headers },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    request.setTimeout(timeoutMs, () =>
      request.destroy(new Error('client_timeout')),
    )
    request.on('error', (error) =>
      resolve({
        status: 0,
        headers: {},
        rawHeaders: [],
        body: Buffer.alloc(0),
        error: error.message,
      }),
    )
    if (body) request.write(body)
    request.end()
  })
}

/** Exact multipart bytes, so the declared length and the body agree. */
export function multipartBody({ fields = {}, file = null, boundary }) {
  const parts = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    )
  }
  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
      ),
      file.content,
      Buffer.from('\r\n'),
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(parts)
}

/**
 * Sign a session token the way better-auth does, using better-auth's own
 * HMAC helper rather than reimplementing it. The harness supplies the same
 * `BETTER_AUTH_SECRET` the server runs with, so this signs a real cookie.
 */
export function signSessionCookie({ apiDirectory, token, secret }) {
  const require = createRequire(join(apiDirectory, 'package.json'))
  const crypto = require('better-auth/crypto')
  return crypto
    .makeSignature(token, secret)
    .then((signature) => `${token}.${signature}`)
}
