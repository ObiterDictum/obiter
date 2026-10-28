import { useCallback, useSyncExternalStore } from 'react'

/**
 * A viewport breakpoint as React state. A narrow viewport is browser state, so
 * it is read from the media query rather than copied into React state by an
 * effect. The server has no viewport: it renders the wide layout and the client
 * corrects on hydration.
 */
export function useMediaQuery(query: string): boolean {
  // The subscribe callback is a referential contract of useSyncExternalStore:
  // a new identity every render would drop and re-add the listener each time.
  const subscribe = useCallback(
    (callback: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', callback)
      return () => list.removeEventListener('change', callback)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  )
}
