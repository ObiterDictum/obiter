import type { ErrorReport } from '@obiter/contracts'
import {
  redactMessage,
  errorFrames,
  routePattern,
} from '@obiter/config/error-reporting'
import { apiUrl } from './lib/api-url'
import { getDesktopAuthToken } from './lib/auth-token'
import { readDesktopBridge } from './lib/desktop-bridge'

let capture:
  | ((
      error: unknown,
      request?: { route: string; status?: number; method?: string },
    ) => void)
  | undefined
export function reportError(
  error: unknown,
  request?: { route: string; status?: number; method?: string },
) {
  capture?.(error, request)
}
export function startErrorReporting(
  source: 'web' | 'desktop',
  build: string | null,
  production: boolean,
) {
  if (!production || typeof window === 'undefined' || capture) return () => {}
  const seen = new Set<string>()
  const queue: ErrorReport[] = []
  const flush = async (hiding = false) => {
    if (!queue.length) return
    const reports: ErrorReport[] = []
    while (queue.length) {
      const next = queue[0]
      if (
        !next ||
        new TextEncoder().encode(
          JSON.stringify({ reports: [...reports, next] }),
        ).length > 32768
      )
        break
      reports.push(next)
      queue.shift()
    }
    if (queue.length) void flush(hiding)
    const body = JSON.stringify({ reports })
    const desktop = readDesktopBridge()
    if (
      hiding &&
      !desktop &&
      navigator.sendBeacon?.(
        apiUrl('/api/telemetry/errors'),
        new Blob([body], { type: 'application/json' }),
      )
    )
      return
    const token = desktop ? await getDesktopAuthToken() : null
    await fetch(apiUrl('/api/telemetry/errors'), {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
    }).catch(() => undefined)
  }
  capture = (error, request) => {
    if (seen.size >= 20) return
    const kind = redactMessage(error instanceof Error ? error.name : 'Error')
    const frames = errorFrames(error)
    const route = routePattern(request?.route ?? window.location.pathname)
    const key = JSON.stringify([kind, frames[0] ?? null, route])
    if (seen.has(key)) return
    seen.add(key)
    const rawMethod = request?.method?.toUpperCase()
    const method =
      rawMethod === 'GET' ||
      rawMethod === 'POST' ||
      rawMethod === 'PUT' ||
      rawMethod === 'PATCH' ||
      rawMethod === 'DELETE' ||
      rawMethod === 'HEAD' ||
      rawMethod === 'OPTIONS'
        ? rawMethod
        : undefined
    queue.push({
      source,
      build,
      kind,
      message: redactMessage(
        error instanceof Error ? error.message : 'Unhandled error',
      ),
      frames,
      route,
      ...(method ? { method } : {}),
      ...(request?.status ? { status: request.status } : {}),
    })
  }
  const onError = (event: ErrorEvent) =>
    reportError(event.error ?? new Error(event.message))
  const onRejection = (event: PromiseRejectionEvent) =>
    reportError(event.reason)
  const onHide = () => {
    void flush(true)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('pagehide', onHide)
  const timer = setInterval(() => {
    void flush()
  }, 5000)
  const unsubscribe = readDesktopBridge()?.onMainError?.((error) =>
    reportError(
      Object.assign(new Error(error.message), {
        name: error.kind,
        stack: error.stack,
      }),
    ),
  )
  return () => {
    clearInterval(timer)
    capture = undefined
    unsubscribe?.()
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('pagehide', onHide)
  }
}
