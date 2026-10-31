import type { ReactPromise } from 'react'

export function preloadable<T>(load: () => Promise<T>) {
  let tracked: ReactPromise<T> | undefined
  return (): ReactPromise<T> => {
    if (tracked) return tracked
    const promise = Object.assign(load(), { status: 'pending' as const })
    tracked = promise
    promise.then(
      (value) => {
        tracked = Object.assign(promise, {
          status: 'fulfilled' as const,
          value,
        })
      },
      (reason: unknown) => {
        Object.assign(promise, { status: 'rejected' as const, reason })
        tracked = undefined
      },
    )
    return promise
  }
}
