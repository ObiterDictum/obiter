/**
 * Fake sandbox renderer for the Playwright lane.
 *
 * The real renderer ships in a separate PR and is a private worker. The e2e
 * suite only needs the agreed HTTP boundary: `/ready` for the webServer health
 * check and `POST /render` returning an intermediate PDF. The API rasterizes
 * that PDF into an image-only secure PDF and validates it, so the response must
 * be a real, parseable PDF. A checked-in synthetic text-layer fixture stands in
 * for the worker's output; the API's rasterizer strips its text layer, so the
 * downloaded artifact still has no selectable source text.
 */
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
    // Drain the sanitized .docx body before answering.
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
