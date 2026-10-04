import { afterEach, describe, expect, it } from 'bun:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import {
  createRedactionRendererClient,
  REDACTION_RENDER_DOCX_CONTENT_TYPE,
  RedactionRendererError,
} from './contract'
import { RENDERER_LIMITS, type RendererLimits } from './limits'
import { RendererFailure, type DocxRenderer } from './renderer'
import { createRendererServer } from './server'

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])

function stubRenderer(overrides: Partial<DocxRenderer> = {}): DocxRenderer {
  return {
    ready: true,
    render: async () => PDF_BYTES,
    close: async () => undefined,
    ...overrides,
  }
}

const servers: Server[] = []

async function startServer(
  getRenderer: () => DocxRenderer | null,
  limits: RendererLimits = RENDERER_LIMITS,
) {
  const server = createRendererServer({ getRenderer, limits })
  servers.push(server)
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  )
  const address = server.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  )
})

function postDocx(baseUrl: string, body: Uint8Array, contentType?: string) {
  return fetch(`${baseUrl}/render`, {
    method: 'POST',
    headers: {
      'content-type': contentType ?? REDACTION_RENDER_DOCX_CONTENT_TYPE,
    },
    body: new Uint8Array(body),
  })
}

describe('redaction renderer HTTP surface', () => {
  it('reports health while the renderer is still starting', async () => {
    const baseUrl = await startServer(() => null)
    const response = await fetch(`${baseUrl}/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('reports not ready until a renderer is warm', async () => {
    const renderer = stubRenderer()
    let current: DocxRenderer | null = null
    const baseUrl = await startServer(() => current)
    const before = await fetch(`${baseUrl}/ready`)
    expect(before.status).toBe(503)
    expect(await before.json()).toEqual({ status: 'starting' })
    current = renderer
    const after = await fetch(`${baseUrl}/ready`)
    expect(after.status).toBe(200)
    expect(await after.json()).toEqual({ status: 'ready' })
  })

  it('returns PDF bytes for a DOCX body', async () => {
    const baseUrl = await startServer(() => stubRenderer())
    const response = await postDocx(baseUrl, new Uint8Array([1, 2, 3]))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES)
  })

  it('rejects a non-DOCX content type with a typed error', async () => {
    const baseUrl = await startServer(() => stubRenderer())
    const response = await postDocx(baseUrl, new Uint8Array([1]), 'text/plain')
    expect(response.status).toBe(415)
    expect(await response.json()).toEqual({
      error: {
        code: 'unsupported_media_type',
        message: 'The render endpoint accepts a DOCX body only.',
      },
    })
  })

  it('returns not_ready when the renderer is absent', async () => {
    const baseUrl = await startServer(() => null)
    const response = await postDocx(baseUrl, new Uint8Array([1]))
    expect(response.status).toBe(503)
    const body = (await response.json()) as {
      error: { code: string; message: string }
    }
    expect(body.error.code).toBe('not_ready')
  })

  it('maps renderer failures to typed statuses', async () => {
    const cases = [
      { code: 'invalid_docx', status: 422 },
      { code: 'too_many_pages', status: 422 },
      { code: 'at_capacity', status: 503 },
      { code: 'render_timeout', status: 504 },
    ] as const
    for (const item of cases) {
      const baseUrl = await startServer(() =>
        stubRenderer({
          render: async () => {
            throw new RendererFailure(item.code)
          },
        }),
      )
      const response = await postDocx(baseUrl, new Uint8Array([1]))
      expect(response.status).toBe(item.status)
      const body = (await response.json()) as { error: { code: string } }
      expect(body.error.code).toBe(item.code)
    }
  })

  it('maps an unexpected renderer error to internal_error', async () => {
    const baseUrl = await startServer(() =>
      stubRenderer({
        render: async () => {
          throw new Error('boom')
        },
      }),
    )
    const response = await postDocx(baseUrl, new Uint8Array([1]))
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('internal_error')
  })

  it('refuses a body above the byte ceiling', async () => {
    const baseUrl = await startServer(() => stubRenderer(), {
      ...RENDERER_LIMITS,
      maxInputBytes: 4,
    })
    const response = await postDocx(baseUrl, new Uint8Array(32))
    expect(response.status).toBe(413)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('input_too_large')
  })

  it('answers an unknown route with a typed 404', async () => {
    const baseUrl = await startServer(() => stubRenderer())
    const response = await fetch(`${baseUrl}/nope`)
    expect(response.status).toBe(404)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('invalid_request')
  })
})

describe('redaction renderer client', () => {
  it('round-trips a render and surfaces typed errors', async () => {
    const baseUrl = await startServer(() =>
      stubRenderer({
        render: async (docx) => {
          if (docx[0] === 9) throw new RendererFailure('invalid_docx')
          return PDF_BYTES
        },
      }),
    )
    const client = createRedactionRendererClient({ baseUrl })
    expect(await client.renderSanitizedDocx(new Uint8Array([1]))).toEqual(
      PDF_BYTES,
    )
    try {
      await client.renderSanitizedDocx(new Uint8Array([9]))
      throw new Error('expected the client to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(RedactionRendererError)
      expect((error as RedactionRendererError).code).toBe('invalid_docx')
      expect((error as RedactionRendererError).status).toBe(422)
    }
  })
})
