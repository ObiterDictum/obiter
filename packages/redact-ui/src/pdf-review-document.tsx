import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, PageViewport } from 'pdfjs-dist'
import { cn } from '@obiter/ui'
import { coverRectsForSpan } from '@obiter/redaction-policy'
import type { DocumentTextLayout } from './types'
import type { RedactionSpan } from '@obiter/redaction-policy'

interface PdfReviewDocumentProps {
  file: Blob
  layout: DocumentTextLayout
  spans: RedactionSpan[]
  selectedId: string | null
  onSelect: (id: string) => void
  categoryClassName: Record<string, string>
}

export function PdfReviewDocument({
  file,
  layout,
  spans,
  selectedId,
  onSelect,
  categoryClassName,
}: PdfReviewDocumentProps) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const objectUrl = URL.createObjectURL(file)
    void import('pdfjs-dist').then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
      try {
        const document = await pdfjs.getDocument(objectUrl).promise
        if (cancelled) {
          void document.destroy()
          return
        }
        setPdf(document)
      } catch (loadError: unknown) {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'PDF preview could not be loaded.',
        )
      }
    })
    return () => {
      cancelled = true
      URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  if (error) {
    return (
      <p className="p-6 text-sm text-danger" role="alert">
        {error}
      </p>
    )
  }

  if (!pdf) {
    return (
      <p className="p-6 text-sm text-muted" role="status">
        Loading PDF…
      </p>
    )
  }

  return (
    <div
      className="flex flex-col items-center gap-4 overflow-x-auto p-4 sm:p-5"
      aria-label="PDF document"
    >
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPage
          key={index}
          pdf={pdf}
          pageNumber={index + 1}
          pageIndex={index}
          layout={layout}
          spans={spans}
          selectedId={selectedId}
          onSelect={onSelect}
          categoryClassName={categoryClassName}
        />
      ))}
    </div>
  )
}

function coverToOverlay(
  viewport: PageViewport,
  cover: { x: number; y: number; width: number; height: number },
) {
  const [x1, y1, x2, y2] = viewport.convertToViewportRectangle([
    cover.x,
    cover.y,
    cover.x + cover.width,
    cover.y + cover.height,
  ])
  return {
    left: Math.min(x1, x2),
    top: Math.min(y1, y2),
    width: Math.max(Math.abs(x2 - x1), 4),
    height: Math.max(Math.abs(y2 - y1), 4),
  }
}

function PdfPage({
  pdf,
  pageNumber,
  pageIndex,
  layout,
  spans,
  selectedId,
  onSelect,
  categoryClassName,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  pageIndex: number
  layout: DocumentTextLayout
  spans: RedactionSpan[]
  selectedId: string | null
  onSelect: (id: string) => void
  categoryClassName: Record<string, string>
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [viewport, setViewport] = useState<PageViewport | null>(null)

  useEffect(() => {
    let cancelled = false
    let renderTask: { cancel: () => void } | null = null

    async function paint() {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return
      const base = page.getViewport({ scale: 1 })
      const available = hostRef.current?.clientWidth || base.width
      const scale = Math.min(1.6, Math.max(0.75, available / base.width))
      const nextViewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      const context = canvas.getContext('2d')
      if (!context) return

      canvas.width = nextViewport.width
      canvas.height = nextViewport.height
      canvas.style.width = `${nextViewport.width}px`
      canvas.style.height = `${nextViewport.height}px`

      renderTask = page.render({
        canvasContext: context,
        viewport: nextViewport,
        canvas,
      })
      await renderTask.promise
      if (cancelled) return
      setViewport(nextViewport)
    }

    void paint()

    const observer =
      typeof ResizeObserver === 'undefined' || !hostRef.current
        ? null
        : new ResizeObserver(() => {
            void paint()
          })
    if (hostRef.current && observer) observer.observe(hostRef.current)

    return () => {
      cancelled = true
      renderTask?.cancel()
      observer?.disconnect()
    }
  }, [pdf, pageNumber])

  const pageSpans =
    viewport == null
      ? []
      : spans.flatMap((span) =>
          coverRectsForSpan({
            segments: layout.segments,
            spanStart: span.start,
            spanEnd: span.end,
            spanText: span.text,
          })
            .filter((cover) => cover.pageIndex === pageIndex)
            .map((cover, index) => ({
              span,
              key: `${span.id}-${index}`,
              ...coverToOverlay(viewport, cover),
            })),
        )

  return (
    <div ref={hostRef} className="w-full max-w-[1080px]">
      <div
        className="relative mx-auto overflow-hidden rounded-lg border border-line-strong bg-raised shadow-lg"
        style={
          viewport
            ? { width: viewport.width, height: viewport.height }
            : undefined
        }
      >
        <canvas ref={canvasRef} className="block" />
        <div className="pointer-events-none absolute inset-0">
          {pageSpans.map((box) => (
            <button
              key={box.key}
              type="button"
              data-span-id={box.span.id}
              aria-label={`${box.span.category.replaceAll('_', ' ')}: ${box.span.text}`}
              aria-pressed={selectedId === box.span.id}
              className={cn(
                'pointer-events-auto absolute rounded-sm border border-transparent opacity-80 transition-opacity hover:opacity-95',
                categoryClassName[box.span.category],
                selectedId === box.span.id && 'opacity-100 ring-2 ring-ring',
              )}
              style={{
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
              }}
              onClick={() => onSelect(box.span.id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
