/**
 * The redaction renderer's HTTP contract, kept free of server dependencies so
 * a caller (the API finalize path) can import it without pulling in Chromium
 * or Playwright. The renderer service itself imports the same codes.
 */
import { RENDERER_LIMITS } from './limits'

/**
 * Worst-case wall clock for one `POST /render` from admission to PDF, derived
 * from the worker's own bounds: a queue wait, then the layout and PDF passes.
 * A client must allow at least this long before giving up, or it can abort a
 * render the worker would still have completed. Kept in sync with `limits.ts`.
 */
export const REDACTION_RENDERER_WORST_CASE_MS =
  RENDERER_LIMITS.queueWaitTimeoutMs + RENDERER_LIMITS.renderTimeoutMs * 2

export const REDACTION_RENDERER_ERROR_CODES = [
  'invalid_request',
  'unsupported_media_type',
  'input_too_large',
  'invalid_docx',
  'unsupported_document',
  'too_many_pages',
  'at_capacity',
  'not_ready',
  'render_timeout',
  'render_cancelled',
  'render_failed',
  'internal_error',
] as const

export type RedactionRendererErrorCode =
  (typeof REDACTION_RENDERER_ERROR_CODES)[number]

export const REDACTION_RENDER_DOCX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface RedactionRendererErrorBody {
  error: { code: RedactionRendererErrorCode; message: string }
}

export class RedactionRendererError extends Error {
  constructor(
    readonly code: RedactionRendererErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RedactionRendererError'
  }
}

export interface RedactionRendererClientConfig {
  /** Origin of the private renderer service, for example `http://127.0.0.1:8790`. */
  baseUrl: string
  fetchImpl?: typeof fetch
  /** Whole-request budget. Defaults to the worker's worst case. */
  timeoutMs?: number
}

export interface RedactionRendererClient {
  renderSanitizedDocx(
    docx: Uint8Array,
    signal?: AbortSignal,
  ): Promise<Uint8Array>
}

export function createRedactionRendererClient(
  config: RedactionRendererClientConfig,
): RedactionRendererClient {
  const fetchImpl = config.fetchImpl ?? fetch
  const timeoutMs = config.timeoutMs ?? REDACTION_RENDERER_WORST_CASE_MS
  const renderUrl = new URL('/render', config.baseUrl).toString()
  return {
    async renderSanitizedDocx(docx, signal) {
      const controller = new AbortController()
      const forwardAbort = () => controller.abort()
      if (signal?.aborted) {
        controller.abort()
      } else {
        signal?.addEventListener('abort', forwardAbort, { once: true })
      }
      const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
      try {
        const response = await fetchImpl(renderUrl, {
          method: 'POST',
          headers: { 'content-type': REDACTION_RENDER_DOCX_CONTENT_TYPE },
          // Copy into a plain ArrayBuffer-backed view: `BodyInit` rejects a
          // buffer that could be shared, and the caller's bytes may be pooled.
          body: new Uint8Array(docx),
          signal: controller.signal,
        })
        if (!response.ok) {
          const body = await readErrorBody(response)
          throw new RedactionRendererError(
            body.error.code,
            body.error.message,
            response.status,
          )
        }
        return new Uint8Array(await response.arrayBuffer())
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', forwardAbort)
      }
    },
  }
}

export function isRedactionRendererErrorCode(
  value: unknown,
): value is RedactionRendererErrorCode {
  return REDACTION_RENDERER_ERROR_CODES.some((code) => code === value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readErrorBody(
  response: Response,
): Promise<RedactionRendererErrorBody> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    parsed = undefined
  }
  if (isRecord(parsed) && isRecord(parsed.error)) {
    const { code, message } = parsed.error
    if (isRedactionRendererErrorCode(code) && typeof message === 'string') {
      return { error: { code, message } }
    }
  }
  return {
    error: {
      code: 'internal_error',
      message: 'The renderer returned an unexpected error.',
    },
  }
}
