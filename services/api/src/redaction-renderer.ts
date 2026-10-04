/**
 * HTTP client for the sandboxed redaction rendering worker.
 *
 * The worker turns a sanitized `.docx` — sensitive text already destructively
 * removed by `buildRedactedDocx` — into an intermediate PDF. It runs in its own
 * process and is reached only over this HTTP contract; this module deliberately
 * does not import the worker package so the API compiles and tests without it.
 *
 * Contract (agreed with the renderer PR, do not redefine):
 *   POST /render  body: raw sanitized .docx bytes
 *                 content-type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
 *                 -> 200 application/pdf bytes
 *                 -> non-2xx typed JSON { error: { code, message } }
 *
 * Any non-2xx, network failure, timeout, or invalid PDF is a hard failure: the
 * caller must not finalize the run or present a substitute artifact.
 */

export const DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type RedactionRendererFailure =
  | 'renderer_unavailable'
  | 'renderer_timeout'
  | 'renderer_error'
  | 'renderer_invalid_pdf'

export class RedactionRendererError extends Error {
  readonly failure: RedactionRendererFailure

  constructor(failure: RedactionRendererFailure, message: string) {
    super(message)
    this.name = 'RedactionRendererError'
    this.failure = failure
  }
}

export interface RedactionRenderer {
  renderDocxToPdf(docxBytes: Buffer): Promise<Uint8Array>
}

export interface HttpRedactionRendererOptions {
  url: string
  timeoutMs?: number
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

const RENDER_TIMEOUT_MS = 60_000

function renderEndpoint(url: string) {
  return `${url.replace(/\/+$/u, '')}/render`
}

function looksLikePdf(bytes: Uint8Array) {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 5))
  return header === '%PDF-'
}

export function createHttpRedactionRenderer(
  options: HttpRedactionRendererOptions,
): RedactionRenderer {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS

  return {
    async renderDocxToPdf(docxBytes) {
      let response: Response
      try {
        response = await fetchImpl(renderEndpoint(options.url), {
          method: 'POST',
          headers: {
            'content-type': DOCX_CONTENT_TYPE,
            accept: 'application/pdf',
          },
          body: new Uint8Array(docxBytes),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        if (error instanceof DOMException && error.name === 'TimeoutError')
          throw new RedactionRendererError(
            'renderer_timeout',
            'The document renderer did not respond in time.',
          )
        if (error instanceof Error && error.name === 'AbortError')
          throw new RedactionRendererError(
            'renderer_timeout',
            'The document renderer did not respond in time.',
          )
        throw new RedactionRendererError(
          'renderer_unavailable',
          'The document renderer could not be reached.',
        )
      }

      if (!response.ok) {
        // The worker's typed failure carries a stable code for diagnostics; the
        // response body is never logged or surfaced, because it could echo
        // document content in a misbehaving implementation.
        throw new RedactionRendererError(
          'renderer_error',
          `The document renderer refused the request (${response.status}).`,
        )
      }

      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!looksLikePdf(bytes))
        throw new RedactionRendererError(
          'renderer_invalid_pdf',
          'The document renderer returned a file that is not a PDF.',
        )
      return bytes
    },
  }
}
