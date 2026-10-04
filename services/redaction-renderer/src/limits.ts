/**
 * Bounds the worker enforces regardless of caller. Values are constants, not
 * environment configuration: a deployment that raises them is a code change,
 * because each one is a fail-closed safety bound rather than a tuning knob.
 */
export interface RendererLimits {
  /** Matches the API's 25 MB document upload cap. */
  maxInputBytes: number
  /** A rendered document larger than this is refused, never partially written. */
  maxPages: number
  /** One layout plus PDF pass. A document that exceeds it is refused. */
  renderTimeoutMs: number
  /** A render that cannot start within this wait is refused `at_capacity`. */
  queueWaitTimeoutMs: number
  /** Renders waiting for the single Chromium page before `at_capacity`. */
  maxQueuedRenders: number
  /** V8 heap ceiling passed to the Chromium renderer process. */
  browserHeapMb: number
}

export const RENDERER_LIMITS: RendererLimits = {
  maxInputBytes: 25 * 1024 * 1024,
  maxPages: 500,
  renderTimeoutMs: 60_000,
  queueWaitTimeoutMs: 60_000,
  maxQueuedRenders: 8,
  browserHeapMb: 512,
}
