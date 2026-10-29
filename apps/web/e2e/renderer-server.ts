import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.OBITER_E2E_RENDERER_PORT ?? 8892)
const fixture = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../data/evals/redact/pdf-short-text-layer-fixture.pdf',
)
const pdf = readFileSync(fixture)

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/ready') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ready' }))
    return
  }
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ status: 'ok' }))
    return
  }
  if (request.method === 'POST' && request.url === '/render') {
    request.on('data', () => undefined)
    request.on('end', () => {
      response.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(pdf.byteLength),
      })
      response.end(pdf)
    })
    return
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: { code: 'not_found', message: 'no' } }))
})

server.listen(port, '127.0.0.1')
