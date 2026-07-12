import type { ReactNode } from 'react'
import { cn } from '@obiter/ui'

export interface PageScaffoldProps {
  title: ReactNode
  eyebrow?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * PageScaffold — the consistent page layout feature screens compose instead of
 * building their own frame. Eyebrow + title + actions header, then content.
 */
export function PageScaffold({
  title,
  eyebrow,
  actions,
  children,
  className,
}: PageScaffoldProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)}>
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {eyebrow ? (
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {title}
          </h1>
        </div>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div className="flex flex-col gap-6">{children}</div>
    </div>
  )
}
