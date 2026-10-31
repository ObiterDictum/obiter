import { isValidElement, useCallback, useRef } from 'react'

type Handler = (...args: never[]) => void

export function useLatestCallback<Args extends unknown[], Result>(
  callback: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(callback)
  latest.current = callback
  return useCallback((...args: Args) => latest.current(...args), [])
}

function pathOf(parent: string, key: string) {
  return parent === '' ? key : `${parent}\u0000${key}`
}

function collect(value: unknown, path: string, latest: Map<string, Handler>) {
  if (typeof value === 'function') {
    // SAFETY: the value is a function and the map only stores callable references.
    latest.set(path, value as Handler)
    return
  }
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    isValidElement(value) ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return
  }
  for (const [key, item] of Object.entries(value)) {
    collect(item, pathOf(path, key), latest)
  }
}

function stabilise(
  value: unknown,
  path: string,
  latest: { current: Map<string, Handler> },
  cache: Map<string, Handler>,
) {
  if (typeof value === 'function') {
    const cached = cache.get(path)
    if (cached) return cached
    const handler: Handler = (...args) => latest.current.get(path)?.(...args)
    cache.set(path, handler)
    return handler
  }
  if (value === null || typeof value !== 'object') return value
  if (
    Array.isArray(value) ||
    isValidElement(value) ||
    value instanceof Map ||
    value instanceof Set
  ) {
    return value
  }
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    next[key] = stabilise(item, pathOf(path, key), latest, cache)
  }
  return next
}

export function useLatestHandlers<T extends object>(value: T): T {
  const latest = useRef<Map<string, Handler>>(new Map())
  const cache = useRef<Map<string, Handler>>(new Map())
  latest.current = new Map()
  collect(value, '', latest.current)
  // SAFETY: stabilise returns the same object shape, with function leaves replaced by stable wrappers.
  return stabilise(value, '', latest, cache.current) as T
}
