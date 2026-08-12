import type { ReactNode } from 'react'
import { A4_HEIGHT_PX, A4_WIDTH_PX } from '../../document-page-units'

export function DocumentDesk({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-8">{children}</div>
  )
}

export function DocumentPage({
  zoom = 100,
  width = A4_WIDTH_PX,
  height = A4_HEIGHT_PX,
  fontFamily,
  children,
}: {
  zoom?: number
  width?: number
  height?: number
  fontFamily?: string
  children: ReactNode
}) {
  const scale = zoom / 100
  return (
    <div
      className="relative"
      style={{
        width: width * scale,
        minHeight: height * scale,
      }}
    >
      <article
        aria-label="Document page"
        className="absolute top-0 left-0 flex flex-col bg-white text-black shadow-[0_12px_40px_rgba(0,0,0,0.38)] ring-1 ring-black/10"
        style={{
          width,
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
