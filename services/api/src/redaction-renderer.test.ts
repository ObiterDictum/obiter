import { describe, expect, it } from 'bun:test'
import {
  createHttpRedactionRenderer,
  DOCX_CONTENT_TYPE,
  RedactionRendererError,
} from './redaction-renderer'

async function withServer(
  handler: (request: Request) => Response | Promise<Response>,
  run: (url: string) => Promise<void>,
) {
  const server = Bun.serve({ port: 0, fetch: handler })
  try {
    await run(`http://127.0.0.1:${server.port}`)
  } finally {
    await server.stop(true)
  }
}

describe('createHttpRedactionRenderer', () => {
  it('posts the sanitized docx bytes and returns the intermediate PDF', async () => {
    const docx = Buffer.from('PK-sanitized-docx')
    let receivedType: string | null = null
    let receivedBody: Buffer | null = null
    await withServer(
      async (request) => {
        receivedType = request.headers.get('content-type')
        receivedBody = Buffer.from(await request.arrayBuffer())
        return new Response(Buffer.from('%PDF-1.7 intermediate'), {
          headers: { 'content-type': 'application/pdf' },
        })
      },
      async (url) => {
        const renderer = createHttpRedactionRenderer({ url })
        const pdf = await renderer.renderDocxToPdf(docx)
        expect(Buffer.from(pdf).toString('latin1')).toBe(
          '%PDF-1.7 intermediate',
        )
      },
    )
    expect(receivedType).toBe(DOCX_CONTENT_TYPE)
    expect(receivedBody).toEqual(docx)
  })

  it('treats a typed non-2xx failure as a hard renderer error', async () => {
    await withServer(
      () =>
        Response.json(
          { error: { code: 'render_failed', message: 'boom' } },
          { status: 422 },
        ),
      async (url) => {
        const renderer = createHttpRedactionRenderer({ url })
        await expect(
          renderer.renderDocxToPdf(Buffer.from('PK')),
        ).rejects.toMatchObject({
          name: 'RedactionRendererError',
          failure: 'renderer_error',
        })
      },
    )
  })

  it.each([
    ['at_capacity', 'renderer_at_capacity', 503],
    ['not_ready', 'renderer_not_ready', 503],
    ['input_too_large', 'renderer_input_too_large', 413],
    ['too_many_pages', 'renderer_too_many_pages', 422],
    ['render_timeout', 'renderer_timeout', 504],
  ])('preserves the worker code %s as %s', async (code, failure, status) => {
    await withServer(
      () => Response.json({ error: { code, message: 'typed' } }, { status }),
      async (url) => {
        const renderer = createHttpRedactionRenderer({ url })
        await expect(
          renderer.renderDocxToPdf(Buffer.from('PK')),
        ).rejects.toMatchObject({ failure })
      },
    )
  })

  it('refuses an oversized response before buffering it whole', async () => {
    await withServer(
      () =>
        new Response(`%PDF-${'x'.repeat(400)}`, {
          headers: { 'content-type': 'application/pdf' },
        }),
      async (url) => {
        const renderer = createHttpRedactionRenderer({
          url,
          maxResponseBytes: 32,
        })
        await expect(
          renderer.renderDocxToPdf(Buffer.from('PK')),
        ).rejects.toMatchObject({ failure: 'renderer_too_large' })
      },
    )
  })

  it('rejects a 200 response that is not a PDF', async () => {
    await withServer(
      () => new Response('not a pdf'),
      async (url) => {
        const renderer = createHttpRedactionRenderer({ url })
        await expect(
          renderer.renderDocxToPdf(Buffer.from('PK')),
        ).rejects.toMatchObject({ failure: 'renderer_invalid_pdf' })
      },
    )
  })

  it('times out a renderer that never answers', async () => {
    await withServer(
      () => new Promise<Response>(() => undefined),
      async (url) => {
        const renderer = createHttpRedactionRenderer({
          url,
          timeoutMs: 25,
        })
        await expect(
          renderer.renderDocxToPdf(Buffer.from('PK')),
        ).rejects.toMatchObject({ failure: 'renderer_timeout' })
      },
    )
  })

  it('reports an unreachable renderer as unavailable', async () => {
    // Port 1 is reserved and never listening; the connection is refused.
    const renderer = createHttpRedactionRenderer({
      url: 'http://127.0.0.1:1',
      timeoutMs: 250,
    })
    await expect(
      renderer.renderDocxToPdf(Buffer.from('PK')),
    ).rejects.toBeInstanceOf(RedactionRendererError)
    await expect(
      renderer.renderDocxToPdf(Buffer.from('PK')),
    ).rejects.toMatchObject({ failure: 'renderer_unavailable' })
  })
})
