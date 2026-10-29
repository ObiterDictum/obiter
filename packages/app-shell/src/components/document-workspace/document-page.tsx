import type { ReactNode, RefObject } from 'react'
import { documentPrintPageRule } from '../../document-print'
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../../document-page-units'

export function DocumentDesk({
  children,
  overlay,
  deskRef,
}: {
  children: ReactNode
  overlay?: ReactNode
  deskRef?: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={deskRef}
      data-document-desk
      className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-inset"
    >
      <div className="mx-auto flex w-max min-w-full flex-col items-center px-8 pt-8 pb-14">
        {children}
      </div>
      {overlay}
    </div>
  )
}

export function DocumentPage({
  zoom = 100,
  width = A4_WIDTH_PX,
  height = A4_HEIGHT_PX,
  fontFamily,
  chromeless = false,
  children,
}: {
  zoom?: number
  width?: number
  height?: number
  fontFamily?: string
  chromeless?: boolean
  children: ReactNode
}) {
  const scale = zoom / 100
  return (
    <div
      data-document-sheet-frame
      data-page-zoom={zoom}
      className="relative"
      style={{
        width: width * scale,
        minHeight: height * scale,
      }}
    >
      <article
        data-document-sheet
        aria-label="Document page"
        className={
          chromeless
            ? 'absolute top-0 left-0 flex flex-col overflow-clip bg-transparent text-ink'
            : 'absolute top-0 left-0 flex flex-col overflow-clip bg-white text-black shadow-[0_12px_40px_rgba(0,0,0,0.38)] ring-1 ring-black/10'
        }
        style={{
          width,
          height,
          minHeight: height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          fontFamily:
            fontFamily ??
            'Calibri, "Segoe UI", "Liberation Sans", Candara, sans-serif',
        }}
      >
        {children}
      </article>
    </div>
  )
}

export function DocumentPrintStyle({
  box,
}: {
  box?: { widthPx: number; heightPx: number }
}) {
  if (!box) return null
  return (
    <style data-document-print media="print">
      {documentPrintPageRule(box)}
    </style>
  )
}
