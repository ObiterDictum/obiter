import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import {
  REDACTION_RENDER_DOCX_CONTENT_TYPE,
  type RedactionRendererErrorCode,
} from './contract'
import { RENDERER_LIMITS, type RendererLimits } from './limits'
import { RendererFailure, type DocxRenderer } from './renderer'

export interface RendererLogEvent {
  method: string
  path: string
  status: number
  code?: RedactionRendererErrorCode
}

export interface RendererServerConfig {
  /** The live renderer, or null between startup and Chromium being warm. */
  getRenderer: () => DocxRenderer | null
  limits?: RendererLimits
  /** Structured only: request line, status and error code; never a body. */
  log?: (event: RendererLogEvent) => void
}

const STATUS_BY_CODE = {
  invalid_request: 400,
  unsupported_media_type: 415,
  input_too_large: 413,
  invalid_docx: 422,
  unsupported_document: 422,
  too_many_pages: 422,
  at_capacity: 503,
  not_ready: 503,
  render_timeout: 504,
  render_cancelled: 499,
  render_failed: 500,
  internal_error: 500,
} satisfies Record<RedactionRendererErrorCode, number>

const MESSAGE_BY_CODE = {
  invalid_request: 'The request was not a valid render request.',
  unsupported_media_type: 'The render endpoint accepts a DOCX body only.',
  input_too_large: 'The document exceeds the renderer input limit.',
  invalid_docx: 'The document could not be read as a DOCX package.',
  unsupported_document: 'The document has no renderable pages.',
  too_many_pages: 'The document exceeds the renderer page limit.',
  at_capacity: 'The renderer is at capacity.',
  not_ready: 'The renderer is not ready.',
  render_timeout: 'The document took too long to render.',
  render_cancelled: 'The render was cancelled.',
  render_failed: 'The document could not be rendered.',
  internal_error: 'The renderer failed unexpectedly.',
} satisfies Record<RedactionRendererErrorCode, string>

export function statusForErrorCode(code: RedactionRendererErrorCode): number {
  return STATUS_BY_CODE[code]
}

export function messageForErrorCode(code: RedactionRendererErrorCode): string {
  return MESSAGE_BY_CODE[code]
}

/** Reads the body with a byte ceiling, refusing rather than buffering past it. */
export async function readRequestBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array> {
  return readStreamBody(request, maxBytes)
}

export async function readStreamBody(
  source: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of source) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.byteLength
    if (total > maxBytes) throw new RendererFailure('input_too_large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export function createRendererServer(config: RendererServerConfig): Server {
  const limits = config.limits ?? RENDERER_LIMITS
  const server = createServer((request, response) => {
    void handle(request, response)
  })

  async function handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://renderer.local')
    if (request.method === 'GET' && url.pathname === '/health') {
      respond(request, response, 200, { status: 'ok' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/ready') {
      const ready = config.getRenderer()?.ready === true
      respond(request, response, ready ? 200 : 503, {
        status: ready ? 'ready' : 'starting',
      })
      return
    }
    if (request.method === 'POST' && url.pathname === '/render') {
      await handleRender(request, response)
      return
    }
    respondError(request, response, 404, 'invalid_request')
  }

  async function handleRender(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const renderer = config.getRenderer()
    if (!renderer?.ready) {
      respondError(request, response, 503, 'not_ready')
      return
    }
    const contentType = (request.headers['content-type'] ?? '')
      .split(';')[0]
      ?.trim()
      .toLowerCase()
    if (contentType !== REDACTION_RENDER_DOCX_CONTENT_TYPE) {
      respondError(request, response, 415, 'unsupported_media_type')
      return
    }
    const abort = new AbortController()
    const onDisconnect = () => {
      if (!response.writableEnded) abort.abort()
    }
    request.on('aborted', onDisconnect)
    response.on('close', onDisconnect)
    try {
      const body = await readRequestBody(request, limits.maxInputBytes)
      const pdf = await renderer.render(body, abort.signal)
      if (response.writableEnded) return
      // An abort after the render resolved must still end the request; the
      // headers are unsent, so a typed 499 is safe to write.
      if (abort.signal.aborted) {
        respondError(request, response, 499, 'render_cancelled')
        return
      }
      response.writeHead(200, {
        'content-type': 'application/pdf',
        'content-length': String(pdf.byteLength),
      })
      response.end(pdf)
      config.log?.({ method: 'POST', path: '/render', status: 200 })
    } catch (error) {
      const code: RedactionRendererErrorCode =
        error instanceof RendererFailure ? error.code : 'internal_error'
      if (response.writableEnded) return
      if (response.headersSent) {
        response.destroy()
        return
      }
      respondError(request, response, statusForErrorCode(code), code)
    } finally {
      request.off('aborted', onDisconnect)
      response.off('close', onDisconnect)
    }
  }

  function respond(
    request: IncomingMessage,
    response: ServerResponse,
    status: number,
    body: Record<string, string>,
  ): void {
    if (response.writableEnded) return
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
    config.log?.({
      method: request.method ?? 'GET',
      path: new URL(request.url ?? '/', 'http://renderer.local').pathname,
      status,
    })
  }

  function respondError(
    request: IncomingMessage,
    response: ServerResponse,
    status: number,
    code: RedactionRendererErrorCode,
  ): void {
    if (response.writableEnded) return
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({ error: { code, message: messageForErrorCode(code) } }),
    )
    config.log?.({
      method: request.method ?? 'GET',
      path: new URL(request.url ?? '/', 'http://renderer.local').pathname,
      status,
      code,
    })
  }

  return server
}
