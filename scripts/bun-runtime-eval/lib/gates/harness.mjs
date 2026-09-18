/*
 * Shared harness state and helpers for the runtime gates.
 *
 * Split out of gates.mjs (which was over the 500-line ceiling).
 * Server lifecycle (startServer/stopServer) and its constants live
 * in ../server.mjs; this module re-exports them so the check
 * modules have a single import site.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { Socket } from 'node:net'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { deflateRawSync } from 'node:zlib'
import { DOCX_CONTENT_TYPE, fixtureFilename } from '../../../load/fixtures.mjs'
import { readEnvAssignment } from '../../../load/target.mjs'
import {
  API_DIR,
  BUN_BIN,
  ENV_FILE,
  RUNTIMES,
  TSX_CLI,
  WORKTREE,
  startServer,
  stopServer,
} from '../server.mjs'

export {
  API_DIR,
  BUN_BIN,
  ENV_FILE,
  RUNTIMES,
  TSX_CLI,
  WORKTREE,
  startServer,
  stopServer,
}

export const OWNED_DATABASE = 'obiter_bun_eval'

export const SECRET = readEnvAssignment(
  await readFile(ENV_FILE, 'utf8'),
  'BETTER_AUTH_SECRET',
)

export const checks = []
let currentGroup = 'general'
/** The DOCX uploaded by the upload gate; the shutdown gate downloads it. */
export const state = { lastUploadedDocumentId: null }

export function group(name) {
  currentGroup = name
}

export function record(name, ok, detail, extra = {}) {
  checks.push({ group: currentGroup, name, ok: Boolean(ok), detail, ...extra })
  const mark = ok ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${currentGroup} :: ${name} — ${detail}`)
}

export const bearer = (token) =>
  token ? { Authorization: `Bearer ${token}` } : {}
export const json = (body, token, extra = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...bearer(token), ...extra },
  body: JSON.stringify(body),
})

export async function rawRequest({
  port,
  path,
  method = 'GET',
  headers = {},
  body,
  timeoutMs = 15_000,
}) {
  return new Promise((done) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path, method, headers },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          done({
            status: response.statusCode,
            headers: response.headers,
            rawHeaders: response.rawHeaders,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('client_timeout'))
    })
    request.on('error', (error) =>
      done({
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

/**
 * A bounded multipart body, assembled by hand so Content-Length is known and
 * the byte count is exact — which is what the body-limit checks need.
 */
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

/** How long an idle keep-alive connection survives before the server closes it. */
export function measureIdleKeepAlive({ port, token, capMs }) {
  return new Promise((done) => {
    const socket = new Socket()
    let started = 0
    socket.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET /api/matters HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\nConnection: keep-alive\r\n\r\n`,
      )
    })
    socket.on('data', () => {
      if (started === 0) started = performance.now()
    })
    socket.on('close', () =>
      done({
        closedMs: started === 0 ? null : performance.now() - started,
        outcome: 'closed',
      }),
    )
    socket.on('error', () => {})
    setTimeout(() => {
      socket.destroy()
      done({ closedMs: null, outcome: 'still_open_at_cap' })
    }, capMs)
  })
}

/** How long a connection that sent only part of a request header survives. */
export function measureHalfHeader({ port, capMs }) {
  return new Promise((done) => {
    const socket = new Socket()
    const started = performance.now()
    socket.connect(port, '127.0.0.1', () => {
      socket.write('GET /api/health HTTP/1.1\r\nHost: localhost\r\nX-Partial: ')
    })
    socket.on('data', () => {
      socket.destroy()
      done({ closedMs: performance.now() - started, outcome: 'answered' })
    })
    socket.on('close', () =>
      done({ closedMs: performance.now() - started, outcome: 'closed' }),
    )
    socket.on('error', () => {})
    setTimeout(() => {
      socket.destroy()
      done({ closedMs: null, outcome: 'still_open_at_cap' })
    }, capMs)
  })
}

/** POST a JSON body with Transfer-Encoding: chunked instead of a length. */
export function chunkedJsonPost({ port, path, token, payload }) {
  return new Promise((done) => {
    const socket = new Socket()
    const started = performance.now()
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      done({ ...result, ms: Math.round(performance.now() - started) })
    }
    socket.connect(port, '127.0.0.1', () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${token}\r\n` +
          `Content-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`,
      )
      const body = Buffer.from(payload, 'utf8')
      // Two chunks, so the decoder is exercised rather than a single write.
      const half = Math.ceil(body.length / 2)
      socket.write(`${half.toString(16)}\r\n`)
      socket.write(body.subarray(0, half))
      socket.write(`\r\n${(body.length - half).toString(16)}\r\n`)
      socket.write(body.subarray(half))
      socket.write('\r\n0\r\n\r\n')
    })
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      const statuses = [
        ...buffered.toString('latin1').matchAll(/HTTP\/1\.1 (\d{3})/g),
      ].map((match) => match[1])
      const last = statuses[statuses.length - 1]
      if (last && last !== '100')
        finish({ status: Number(last), usedChunkedEncoding: true })
    })
    socket.on('error', (error) =>
      finish({ status: 0, usedChunkedEncoding: true, error: error.message }),
    )
    setTimeout(
      () =>
        finish({
          status: 0,
          usedChunkedEncoding: true,
          error: 'client_timeout',
        }),
      20_000,
    )
  })
}

/**
 * A multipart upload that sends headers with `Expect: 100-continue` first and
 * only writes the body after the interim response. Bounded, because the failure
 * mode this checks for is a hang.
 */
export function expectContinueUpload({ port, token, matterId, fixture }) {
  return new Promise((done) => {
    const boundary = `----obiterevalexpect${Date.now()}`
    const body = multipartBody({
      boundary,
      fields: {
        filename: fixtureFilename(fixture),
        fileType: 'docx',
        sizeBytes: String(fixture.bytes),
        contentSha256: createHash('sha256')
          .update(fixture.content)
          .digest('hex'),
      },
      file: {
        filename: fixtureFilename(fixture),
        contentType: DOCX_CONTENT_TYPE,
        content: fixture.content,
      },
    })
    const socket = new Socket()
    const started = performance.now()
    let interim = false
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      done({ ...result, ms: performance.now() - started })
    }
    socket.connect(port, '127.0.0.1', () => {
      socket.write(
        `POST /api/matters/${matterId}/documents HTTP/1.1\r\n` +
          `Host: localhost\r\nAuthorization: Bearer ${token}\r\n` +
          `Content-Type: multipart/form-data; boundary=${boundary}\r\n` +
          `Content-Length: ${body.byteLength}\r\nExpect: 100-continue\r\n\r\n`,
      )
      setTimeout(() => {
        if (!interim) socket.write(body)
      }, 250)
    })
    let buffered = Buffer.alloc(0)
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      const text = buffered.toString('latin1')
      if (!interim && text.includes('100 Continue')) {
        interim = true
        socket.write(body)
      }
      // The interim `100 Continue` line stays in the buffer, so take the last
      // status line rather than the first.
      const statuses = [...text.matchAll(/HTTP\/1\.1 (\d{3})/g)].map(
        (m) => m[1],
      )
      const last = statuses[statuses.length - 1]
      if (last && last !== '100') finish({ interim, status: Number(last) })
    })
    socket.on('error', (error) =>
      finish({ interim, status: 0, error: error.message }),
    )
    setTimeout(
      () => finish({ interim, status: 0, error: 'client_timeout' }),
      15_000,
    )
  })
}

/** A ZIP with a huge uncompressed size behind a tiny deflate stream. */
export function makeZipBomb() {
  // A minimal stored-then-deflated DOCX-shaped zip: one entry declaring a very
  // large uncompressed size with a highly compressible payload. The ooxml
  // limits refuse it on the declared ratio before inflating.
  const name = Buffer.from('[Content_Types].xml')
  const payload = Buffer.alloc(2 * 1024 * 1024, 0x41)
  const deflated = deflateRawSync(payload)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(0, 14)
  local.writeUInt32LE(deflated.length, 18)
  local.writeUInt32LE(payload.length, 22)
  local.writeUInt16LE(name.length, 26)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(deflated.length, 20)
  central.writeUInt32LE(payload.length, 24)
  central.writeUInt16LE(name.length, 28)
  const centralOffset = local.length + name.length + deflated.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, name, deflated, central, name, end])
}

/**
 * Sign a session token the way better-auth does, using better-auth's own
 * published helper rather than reimplementing the HMAC.
 */
export async function signSessionCookie(token) {
  const { createRequire } = await import('node:module')
  const require = createRequire(join(API_DIR, 'package.json'))
  const crypto = require('better-auth/crypto')
  return `${token}.${await crypto.makeSignature(token, SECRET)}`
}
