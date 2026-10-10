import { useMemo } from 'react'
import type { DocumentPdfViewResponse } from '@obiter/contracts'
import { Button } from '@obiter/ui'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

/**
 * The stored PDF layout, one page at a time. The segment index is built once
 * per view so a page turn is O(segments on that page), not a scan of the whole
 * document: a 500-page layout's `segments` array is walked exactly once, and
 * only the current page's spans ever mount — the DOM the browser lays out is
 * bounded by a page, not by the document.
 */
export function DocumentPdfPages({
  view,
  pageIndex,
  onPageIndexChange,
  zoom,
}: {
  view: DocumentPdfViewResponse
  pageIndex: number
  onPageIndexChange: (index: number) => void
  zoom: number
}) {
  const segmentsByPage = useMemo(() => {
    const grouped = new Map<number, number[]>()
    view.layout.segments.forEach((segment, index) => {
      const list = grouped.get(segment.pageIndex)
      if (list) {
        list.push(index)
      } else {
        grouped.set(segment.pageIndex, [index])
      }
    })
    return grouped
  }, [view])

  const page = view.layout.pages[pageIndex]
  const lastIndex = view.layout.pages.length - 1
  if (!page) {
    return (
      <p className="text-sm text-muted" role="status">
        This PDF has no layout pages to display.
      </p>
    )
  }

  const scale = zoom / 100
  const segmentIndexes = segmentsByPage.get(pageIndex) ?? []

  const jump = (value: string): boolean => {
    const target = Number(value)
    if (!Number.isInteger(target) || target < 1 || target > lastIndex + 1) {
      return false
    }
    onPageIndexChange(target - 1)
    return true
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous page"
          disabled={pageIndex === 0}
          onClick={() => onPageIndexChange(Math.max(0, pageIndex - 1))}
          iconStart={<CaretLeft size={16} aria-hidden />}
        >
          Previous
        </Button>
        <label className="flex items-center gap-1 font-mono text-xs text-muted">
          <input
            key={pageIndex}
            type="text"
            inputMode="numeric"
            defaultValue={pageIndex + 1}
            aria-label={`Go to page, of ${view.layout.pages.length}`}
            className="w-12 rounded-sm border border-line bg-transparent px-1 text-center"
            onKeyDown={(event) => {
              // A refused jump resets the field to the page being shown —
              // leaving the refused number displayed claims a page the
              // viewer is not on.
              if (event.key === 'Enter' && !jump(event.currentTarget.value)) {
                event.currentTarget.value = String(pageIndex + 1)
              }
            }}
            onBlur={(event) => {
              if (!jump(event.target.value)) {
                event.target.value = String(pageIndex + 1)
              }
            }}
          />
          <span aria-hidden="true">/ {view.layout.pages.length}</span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next page"
          disabled={pageIndex >= lastIndex}
          onClick={() => onPageIndexChange(Math.min(lastIndex, pageIndex + 1))}
          iconEnd={<CaretRight size={16} aria-hidden />}
        >
          Next
        </Button>
      </div>
      <div
        className="overflow-auto"
        role="region"
        aria-label={`PDF page ${pageIndex + 1}`}
      >
        <div
          className="relative bg-[#fcfcfa] text-[#1f1f1f] shadow-[0_12px_40px_rgba(0,0,0,0.38)] ring-1 ring-black/10"
          style={{
            width: page.width * scale,
            height: page.height * scale,
            fontFamily:
              "Calibri, 'Segoe UI', 'Liberation Sans', Candara, sans-serif",
          }}
        >
          {segmentIndexes.map((segmentIndex, index) => {
            const segment = view.layout.segments[segmentIndex]
            if (!segment) return null
            return (
              <span
                key={`${segment.start}-${index}`}
                className="absolute overflow-visible whitespace-pre"
                style={{
                  left: segment.x * scale,
                  top: (page.height - segment.y - segment.height) * scale,
                  width: Math.max(segment.width * scale, 1),
                  height: Math.max(segment.height * scale, 8),
                  fontSize: Math.max(segment.height * scale * 0.85, 8),
                  lineHeight: 1,
                }}
              >
                {view.text.slice(segment.start, segment.end)}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
