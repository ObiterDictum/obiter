import { useLayoutEffect, useRef } from 'react'
import { FindCaseLawNotices } from '../components/search/FindCaseLawNotices'

export function StickyJudgmentNotices() {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const notice = ref.current
    const scroller = notice?.closest<HTMLElement>('[data-shell-scroll]')
    if (!notice || !scroller) return

    const previousPadding = scroller.style.scrollPaddingTop

    const updatePin = () => {
      const height = Math.ceil(notice.getBoundingClientRect().height)
      const canPin = height <= scroller.getBoundingClientRect().height / 2
      notice.style.position = canPin ? '' : 'static'
      scroller.toggleAttribute('data-judgment-notices-inline', !canPin)
      scroller.style.scrollPaddingTop = canPin
        ? `calc(${height}px + 0.25rem)`
        : previousPadding
    }
    updatePin()
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(updatePin)
    observer?.observe(notice)
    observer?.observe(scroller)
    return () => {
      observer?.disconnect()
      notice.style.position = ''
      scroller.removeAttribute('data-judgment-notices-inline')
      scroller.style.scrollPaddingTop = previousPadding
    }
  }, [])

  return (
    <div ref={ref} className="sticky top-0 z-10">
      <FindCaseLawNotices />
    </div>
  )
}
