import { useEffect, useState, type RefObject } from 'react'

/**
 * The element's content-box width in CSS pixels, kept current by a
 * ResizeObserver — an external browser API, which is the boundary the
 * subscription rule exists for. Returns `null` where ResizeObserver is
 * unavailable (the test DOM) so the caller decides the fallback measure.
 *
 * `attached` is the condition under which the element exists at all: the
 * document column mounts after the model loads, so an observer started on the
 * first render would watch nothing and never report. The caller passes
 * whatever says the element is in the tree; the observer restarts when that
 * flips.
 */
export function useElementWidth(
  ref: RefObject<HTMLElement | null>,
  attached = true,
): number | null {
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!attached) return
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width
      if (measured !== undefined) setWidth(Math.floor(measured))
    })
    observer.observe(element)
    setWidth(Math.floor(element.getBoundingClientRect().width))
    return () => observer.disconnect()
  }, [ref, attached])
  return width
}
