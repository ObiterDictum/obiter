import { useEffect, useMemo, useRef } from 'react'
import type { DocumentPdfViewResponse } from '@obiter/contracts'
import { Button } from '@obiter/ui'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { pdfSliceBounds, type PdfFindHit } from '../../document-find'

/**
 * The stored PDF layout, one page at a time. The segment index is built once
 * per view so a page turn is O(segments on that page), not a scan of the
 * whole document: a 500-page layout's `segments` array is walked exactly
 * once, and only the current page's spans ever mount — the DOM the browser
 * lays out is bounded by a page, not by the document. Find highlights follow
 * the same bound: hits were computed once over the whole text, and only the
 * current page's slices mount.
 */
export function DocumentPdfPages({
  view,
  pageIndex,
  onPageIndexChange,
  zoom,
  find,
}: {
  view: DocumentPdfViewResponse
  pageIndex: number
  onPageIndexChange: (index: number) => void
  zoom: number
  /** The find hit set and the active index; only the current page's slices
   * ever render, the active one prominent and scrolled into view. */
  find?: { hits: readonly PdfFindHit[]; active: number }
}) {
  const { layout, text } = view
  const segmentsByPage = useMemo(() => {
    const grouped = new Map<number, number[]>()
    layout.segments.forEach((segment, index) => {
      const list = grouped.get(segment.pageIndex)
      if (list) {
        list.push(index)
      } else {
        grouped.set(segment.pageIndex, [index])
      }
    })
    return grouped
  }, [layout])
  const sheet = useRef<HTMLDivElement>(null)
  useEffect(() => {
    sheet.current
      ?.querySelector('[data-pdf-find-slice=active]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [pageIndex, find?.active])

  const page = layout.pages[pageIndex]
  const lastIndex = layout.pages.length - 1
  if (!page) {
    return (
      <p className="text-sm text-muted" role="status">
        This PDF has no layout pages to display.
      </p>
    )
  }

  const scale = zoom / 100
  const segmentIndexes = segmentsByPage.get(pageIndex) ?? []
  const findHighlights = find?.hits.flatMap((hit, hitIndex) =>
    hit.slices.flatMap((slice) => {
      const segment = layout.segments[slice.segment]
      if (!segment || segment.pageIndex !== pageIndex) return []
      const bounds = pdfSliceBounds(segment, slice)
      const active = hitIndex === find.active
      return [
        <span
          key={`${hitIndex}:${slice.segment}`}
          aria-hidden
          data-pdf-find-slice={active ? 'active' : 'hit'}
          className={`absolute rounded-[2px] ${
            active
              ? 'bg-amber-400/60 ring-1 ring-amber-700/40'
              : 'bg-amber-300/35'
          }`}
          style={{
            left: (segment.x + bounds.left) * scale,
            top: (page.height - segment.y - segment.height) * scale,
            width: Math.max(bounds.width * scale, 2),
            height: Math.max(segment.height * scale, 4),
          }}
        />,
      ]
    }),
  )

  const jump = (input: HTMLInputElement) => {
    const target = +input.value
    if (!Number.isInteger(target) || target < 1 || target > lastIndex + 1) {
      // A refused jump resets the field to the page being shown — leaving
      // the refused number displayed claims a page the viewer is not on.
      input.value = String(pageIndex + 1)
      return
    }
    onPageIndexChange(target - 1)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-label="Previous page"
          disabled={pageIndex === 0}
          onClick={() => onPageIndexChange(pageIndex - 1)}
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
            aria-label={`Go to page, of ${lastIndex + 1}`}
            className="w-12 rounded-sm border border-line bg-transparent px-1 text-center"
            onKeyDown={(event) => {
              if (event.key === 'Enter') jump(event.currentTarget)
            }}
            onBlur={(event) => jump(event.target)}
          />
          <span aria-hidden="true">/ {lastIndex + 1}</span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Next page"
          disabled={pageIndex >= lastIndex}
          onClick={() => onPageIndexChange(pageIndex + 1)}
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
          ref={sheet}
          className="relative bg-[#fcfcfa] text-[#1f1f1f] shadow-[0_12px_40px_rgba(0,0,0,0.38)] ring-1 ring-black/10"
          style={{
            width: page.width * scale,
            height: page.height * scale,
            fontFamily:
              "Calibri, 'Segoe UI', 'Liberation Sans', Candara, sans-serif",
          }}
        >
          {findHighlights}
          {segmentIndexes.map((segmentIndex, index) => {
            const segment = layout.segments[segmentIndex]
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
                {text.slice(segment.start, segment.end)}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}
