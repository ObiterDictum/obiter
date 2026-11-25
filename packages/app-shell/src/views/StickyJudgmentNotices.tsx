import { useLayoutEffect, useRef } from 'react'
import { FindCaseLawNotices } from '../components/search/FindCaseLawNotices'

export function StickyJudgmentNotices() {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const notice = ref.current
    const scroller = notice?.closest<HTMLElement>('[data-shell-scroll]')
    if (!notice || !scroller) return

    const previousPadding = scroller.style.scrollPaddingTop

    const publishHeight = () => {
      const height = Math.ceil(notice.getBoundingClientRect().height)
      scroller.style.scrollPaddingTop = `calc(${height}px + 0.25rem)`
    }
    publishHeight()
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(publishHeight)
    observer?.observe(notice)
    return () => {
      observer?.disconnect()
      scroller.style.scrollPaddingTop = previousPadding
    }
  }, [])

  return (
    <div ref={ref} className="sticky top-0 z-10">
      <FindCaseLawNotices />
    </div>
  )
}
