import type { ReactNode, RefObject } from 'react'
import { documentPrintPageRule } from '../../document-print'
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../../document-page-units'

export function DocumentDesk({
  children,
  overlay,
  deskRef,
}: {
  children: ReactNode
  /** Painted against the scroll box itself, not the centred content column. */
  overlay?: ReactNode
  /** The scroll box, for a caller that fits its content to the width. */
  deskRef?: RefObject<HTMLDivElement | null>
}) {
  // The inner column is `w-max`: when the paper is wider than the canvas the
  // column grows to the paper instead of centring an over-wide box, so the
  // page keeps its gutter and shadow and the canvas scrolls to it. When it
  // fits, `min-w-full` plus `items-center` centres it. The overlay stays a
  // direct child so the marker layer's measured offsets keep the desk origin.
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
  /** The continuous web view drops the paper chrome — the page keeps its
   * scaled measure but loses the sheet, ring and shadow. */
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

/**
 * The `@page` rule for the document being printed. It lives in the workspace
 * because the paper size is the document's own section page box, not a fixed A4.
 */
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
