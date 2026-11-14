import { useEffect, useRef, useState } from 'react'

export function useElementWidth(fallback: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof ResizeObserver === 'undefined') {
      setWidth(fallback)
      return
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width
      if (measured !== undefined && measured > 0) {
        setWidth(Math.floor(measured))
      }
    })
    observer.observe(node)
    const initial = node.getBoundingClientRect().width
    if (initial > 0) setWidth(Math.floor(initial))
    return () => observer.disconnect()
  }, [fallback])
  return { ref, width }
}
