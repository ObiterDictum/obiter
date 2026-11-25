import { useLayoutEffect, useRef } from 'react'
import { FindCaseLawNotices } from '../components/search/FindCaseLawNotices'

export function StickyJudgmentNotices() {
  const ref = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const notice = ref.current
    const scroller = notice?.closest<HTMLElement>('[data-shell-scroll]')
    if (!notice || !scroller) return

    const previousPadding = scroller.style.scrollPaddingTop

    const updatePin = () => {
      notice.style.maxHeight = `${scroller.getBoundingClientRect().height * 0.4}px`
      const height = Math.ceil(notice.getBoundingClientRect().height)
      scroller.style.scrollPaddingTop = `calc(${height}px + 0.25rem)`
    }
    updatePin()
    let frame = 0
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(updatePin)
          })
    observer?.observe(notice)
    observer?.observe(scroller)
    return () => {
      observer?.disconnect()
      cancelAnimationFrame(frame)
      notice.style.maxHeight = ''
      scroller.style.scrollPaddingTop = previousPadding
    }
  }, [])

  return <FindCaseLawNotices readerRef={ref} />
}
