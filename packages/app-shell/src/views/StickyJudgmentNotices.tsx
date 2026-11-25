import { useLayoutEffect, useRef } from 'react'
import { FindCaseLawNotices } from '../components/search/FindCaseLawNotices'

export function StickyJudgmentNotices() {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const notice = ref.current
    const readingArea = notice?.parentElement
    if (!notice || !readingArea) return

    const publishHeight = () => {
      readingArea.style.setProperty(
        '--judgment-notice-height',
        `${notice.getBoundingClientRect().height}px`,
      )
    }
    publishHeight()
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(publishHeight)
    observer?.observe(notice)
    return () => {
      observer?.disconnect()
      readingArea.style.removeProperty('--judgment-notice-height')
    }
  }, [])

  return (
    <div ref={ref} className="sticky top-0 z-10">
      <FindCaseLawNotices />
    </div>
  )
}
