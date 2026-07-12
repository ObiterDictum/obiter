import type { ReactNode } from 'react'
import { cn } from './lib/cn'

export interface CardProps {
  action?: ReactNode
  children: ReactNode
  className?: string
  eyebrow?: ReactNode
  title?: ReactNode
}

/**
 * Card — a quiet surface for grouping related content. Existing API (kept for
 * the Search views); elevation is restrained, borders carry the structure.
 */
export function Card({
  action,
  children,
  className,
  eyebrow,
  title,
}: CardProps) {
  return (
    <section
      className={cn(
        'rounded-lg border border-line bg-surface shadow-sm',
        className,
      )}
    >
      {eyebrow || title || action ? (
        <div className="flex items-start justify-between gap-4 px-5 pt-4">
          <div>
            {eyebrow ? (
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-subtle">
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2 className="text-base font-semibold text-ink">{title}</h2>
            ) : null}
          </div>
          {action ? <div className="text-sm text-muted">{action}</div> : null}
        </div>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  )
}
