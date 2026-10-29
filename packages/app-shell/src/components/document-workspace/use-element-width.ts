import { useEffect, useState, type RefObject } from 'react'

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
