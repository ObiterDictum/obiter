import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './lib/cn'

export interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  leading?: ReactNode
  trailing?: ReactNode
}

/**
 * ListRow — one row of a divided list (attention items, search results,
 * documents). Presentation only: the caller owns the link/button and its
 * hover and selected state, so a row never becomes an unlabelled control.
 */
export function ListRow({
  leading,
  trailing,
  children,
  className,
  ...props
}: ListRowProps) {
  return (
    <div
      className={cn(
        'flex min-h-row min-w-0 items-center gap-3 px-6 py-4 text-body text-ink',
        className,
      )}
      {...props}
    >
      {leading ? (
        <div className="flex size-5 shrink-0 items-center justify-center text-muted">
          {leading}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">{children}</div>
      {trailing ? (
        <div className="shrink-0 text-meta text-muted">{trailing}</div>
      ) : null}
    </div>
  )
}
