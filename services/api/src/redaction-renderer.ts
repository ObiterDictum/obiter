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
  // The worker is healthy but busy or still warming. Distinct from a generic
  // error because both are retriable rather than a property of the document.
  | 'renderer_at_capacity'
  | 'renderer_not_ready'
  // The document itself is outside a worker bound and will fail every retry.
  | 'renderer_input_too_large'
  | 'renderer_too_many_pages'
  | 'renderer_error'
  | 'renderer_invalid_pdf'
  // The response body exceeded this client's buffer ceiling before any parse.
  | 'renderer_too_large'

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
  /**
   * Ceiling on the intermediate PDF before it is buffered whole. Defaults to
   * `MAX_INTERMEDIATE_PDF_BYTES`; overridable so a test can prove the bound
   * without allocating the production cap.
   */
  maxResponseBytes?: number
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Whole-request budget for one `POST /render`.
 *
 * The worker's bounded worst case is two 60s render passes (a layout pass plus
 * `page.pdf`) plus up to 60s waiting for its single render slot, plus Node-side
 * DOCX parse/inflate before the passes start. 240s covers that with headroom.
 * A shorter API timeout aborts a legitimate large render while the worker keeps
 * rendering and holding its only slot, so the retry fails the same way and the
 * worker stays saturated.
 *
 * Follow-up: once the renderer contract exposes its limits, import the shared
 * constants here instead of restating them. This module deliberately does not
 * depend on the renderer package yet.
 */
const RENDER_TIMEOUT_MS = 240_000

/**
 * Ceiling on the intermediate PDF before it is buffered whole. The 200 MB
 * final-artifact limit is checked after rasterization; this bound stops an
 * oversized or runaway response from being read into API memory first.
 */
const MAX_INTERMEDIATE_PDF_BYTES = 200 * 1024 * 1024

/** Typed worker failures are small JSON bodies; anything larger is ignored. */
const MAX_ERROR_BODY_BYTES = 16 * 1024

const FAILURE_BY_WORKER_CODE = [
  ['at_capacity', 'renderer_at_capacity'],
  ['not_ready', 'renderer_not_ready'],
  ['input_too_large', 'renderer_input_too_large'],
  ['too_many_pages', 'renderer_too_many_pages'],
  ['render_timeout', 'renderer_timeout'],
] as const satisfies ReadonlyArray<readonly [string, RedactionRendererFailure]>

function workerFailureForCode(code: unknown): RedactionRendererFailure | null {
  if (typeof code !== 'string') return null
  const match = FAILURE_BY_WORKER_CODE.find(
    ([workerCode]) => workerCode === code,
  )
  return match ? match[1] : null
}

function renderEndpoint(url: string) {
  return `${url.replace(/\/+$/u, '')}/render`
}

function looksLikePdf(bytes: Uint8Array) {
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 5))
  return header === '%PDF-'
}

async function readBoundedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new RedactionRendererError(
      'renderer_too_large',
      'The document renderer returned an oversized file.',
    )

  const body = response.body
  if (!body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes)
      throw new RedactionRendererError(
        'renderer_too_large',
        'The document renderer returned an oversized file.',
      )
    return bytes
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new RedactionRendererError(
          'renderer_too_large',
          'The document renderer returned an oversized file.',
        )
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

/**
 * Read only the stable worker code from a typed failure. The message is never
 * logged or surfaced: a misbehaving worker could echo document content in it.
 */
async function readWorkerFailure(
  response: Response,
): Promise<RedactionRendererFailure> {
  try {
    const bytes = await readBoundedBody(response, MAX_ERROR_BODY_BYTES)
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (isRecord(parsed) && isRecord(parsed.error)) {
      const failure = workerFailureForCode(parsed.error.code)
      if (failure) return failure
    }
  } catch {
    // Fall through to the generic category.
  }
  return 'renderer_error'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function createHttpRedactionRenderer(
  options: HttpRedactionRendererOptions,
): RedactionRenderer {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? RENDER_TIMEOUT_MS
  const maxResponseBytes =
    options.maxResponseBytes ?? MAX_INTERMEDIATE_PDF_BYTES

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
        const failure = await readWorkerFailure(response)
        throw new RedactionRendererError(
          failure,
          `The document renderer refused the request (${response.status}).`,
        )
      }

      const bytes = await readBoundedBody(response, maxResponseBytes)
      if (!looksLikePdf(bytes))
        throw new RedactionRendererError(
          'renderer_invalid_pdf',
          'The document renderer returned a file that is not a PDF.',
        )
      return bytes
    },
  }
}
