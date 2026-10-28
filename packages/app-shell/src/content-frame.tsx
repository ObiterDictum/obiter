import { cn } from '@obiter/ui'
import type { ReactNode } from 'react'

/**
 * The one content column of the frame: a 48px gutter at 1440 and 32px at 1024,
 * capped so the column stops at 1120px of content. The top bar and every page
 * surface use it, which is what keeps the breadcrumb, the page title and the
 * header actions on the same left and right edges.
 */
export function ContentFrame({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full max-w-[1216px] px-12 max-compact:px-8',
        className,
      )}
    >
      {children}
    </div>
  )
}
