import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const port = Number(process.env.PORT ?? 8788)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function json(res, status, body) {
  const payload = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(payload.byteLength),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise((resolve) => {
    let bytes = 0
    let complete = false
    req.on('data', (chunk) => {
      bytes += chunk.length
    })
    req.on('end', () => {
      complete = true
      resolve({ bytes, complete })
    })
    req.on('close', () => {
      if (!complete) resolve({ bytes, complete: false })
    })
  })
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://origin')

  if (url.pathname === '/health') {
    json(res, 200, { status: 'ok' })
    return
  }

  if (url.pathname === '/headers') {
    const received = Buffer.byteLength(
      Object.entries(req.headers)
        .map(
          ([name, value]) =>
            `${name}: ${Array.isArray(value) ? value.join(',') : value}`,
        )
        .join('\r\n'),
    )
    json(res, 200, { headerBytes: received })
    return
  }

  if (url.pathname === '/upload' && req.method === 'POST') {
    const result = await readBody(req)
    if (!result.complete) return
    json(res, 201, { bytes: result.bytes })
    return
  }

  if (url.pathname === '/stream') {
    const param = (name, fallback) => {
      const raw = url.searchParams.get(name)
      if (raw === null) return fallback
      return raw.trim() === '' ? Number.NaN : Number(raw)
    }
    const reject = (detail) =>
      json(res, 400, { error: 'invalid_stream_params', detail })

    const chunks = param('chunks', 20)
    if (!Number.isInteger(chunks) || chunks < 1 || chunks > 256) {
      reject('chunks must be an integer between 1 and 256')
      return
    }
    const chunkBytes = param('chunkBytes', 32 * 1024)
    if (
      !Number.isInteger(chunkBytes) ||
      chunkBytes < 1 ||
      chunkBytes > 4 * 1024 * 1024
    ) {
      reject('chunkBytes must be an integer between 1 and 4194304')
      return
    }
    const intervalMs = param('intervalMs', 500)
    if (
      !Number.isInteger(intervalMs) ||
      intervalMs < 0 ||
      intervalMs > 60_000
    ) {
      reject('intervalMs must be an integer between 0 and 60000')
      return
    }
    const headerDelayMs = param('headerDelayMs', 0)
    if (
      !Number.isInteger(headerDelayMs) ||
      headerDelayMs < 0 ||
      headerDelayMs > 60_000
    ) {
      reject('headerDelayMs must be an integer between 0 and 60000')
      return
    }

    if (headerDelayMs > 0) await sleep(headerDelayMs)
    res.writeHead(200, {
      'content-type': 'application/octet-stream',
      'content-length': String(chunks * chunkBytes),
    })
    const block = Buffer.alloc(chunkBytes, 0x61)
    for (let index = 0; index < chunks; index += 1) {
      if (res.destroyed || res.writableEnded) return
      if (!res.write(block)) {
        await new Promise((resolve) => res.once('drain', resolve))
      }
      if (index < chunks - 1) await sleep(intervalMs)
    }
    res.end()
    return
  }

  json(res, 404, { error: 'not_found' })
})

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`synthetic origin listening on ${port}`)
  })
}
