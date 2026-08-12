import type { DocumentPdfViewResponse } from '@obiter/contracts'
import { Button } from '@obiter/ui'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'

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
  const segments = view.layout.segments.filter(
    (segment) => segment.pageIndex === pageIndex,
  )

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
        <p className="font-mono text-xs text-muted">
          {pageIndex + 1} / {view.layout.pages.length}
        </p>
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
          {segments.map((segment, index) => (
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
          ))}
        </div>
      </div>
    </div>
  )
}
