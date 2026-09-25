/*
 * Synthetic origin for the proxy-boundary checks.
 *
 * This is not the product API. It exists because a real upload or download
 * cannot be paced to a chosen duration on demand, and the proxy's deadlines
 * must be tested at exact byte and time boundaries. The product's own
 * behaviour through the same proxy is proved separately against the real
 * images; this file only isolates what Traefik does.
 *
 * Size and pacing arrive as query parameters so the harness declares them and
 * the origin reports what it actually saw, rather than the two agreeing by
 * assumption. It has no filesystem access and holds nothing.
 */
import { createServer } from 'node:http'

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

/** Read the whole body, reporting the byte count the server observed. */
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

const server = createServer(async (req, res) => {
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
    // A body the proxy cut never finishes; answering would hide that from the
    // client as a partial success.
    if (!result.complete) return
    json(res, 201, { bytes: result.bytes })
    return
  }

  if (url.pathname === '/stream') {
    const chunks = Number(url.searchParams.get('chunks') ?? '20')
    const chunkBytes = Number(url.searchParams.get('chunkBytes') ?? '32768')
    const intervalMs = Number(url.searchParams.get('intervalMs') ?? '500')
    const headerDelayMs = Number(url.searchParams.get('headerDelayMs') ?? '0')
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

server.listen(port, '0.0.0.0', () => {
  console.log(`synthetic origin listening on ${port}`)
})
