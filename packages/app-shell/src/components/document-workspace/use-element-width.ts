import { useEffect, useState, type RefObject } from 'react'

/**
 * The element's content-box width in CSS pixels, kept current by a
 * ResizeObserver — an external browser API, which is the boundary the
 * subscription rule exists for. Returns `null` where ResizeObserver is
 * unavailable (the test DOM) so the caller decides the fallback measure.
 */
export function useElementWidth(
  ref: RefObject<HTMLElement | null>,
): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width
      if (measured !== undefined) setWidth(Math.floor(measured))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return width
}
