export interface RendererLimits {
  maxInputBytes: number
  maxPages: number
  renderTimeoutMs: number
  queueWaitTimeoutMs: number
  maxQueuedRenders: number
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
