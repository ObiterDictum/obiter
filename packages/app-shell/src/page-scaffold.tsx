import type { ReactNode } from 'react'
import { cn } from '@obiter/ui'
import { ContentFrame } from './content-frame'

export interface PageScaffoldProps {
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function PageScaffold({
  title,
  eyebrow,
  description,
  actions,
  children,
  className,
}: PageScaffoldProps) {
  return (
    <ContentFrame className={cn('py-14', className)}>
      <header className="mb-10 flex items-center justify-between gap-6 max-compact:flex-col max-compact:items-stretch max-compact:gap-4">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-1 text-meta text-subtle">{eyebrow}</p>
          ) : null}
          <h1 className="text-page text-ink">{title}</h1>
          {description ? (
            <div className="mt-2 max-w-[68ch] text-body text-muted">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 max-compact:justify-start">
            {actions}
          </div>
        ) : null}
      </header>
      <div className="flex flex-col gap-10">{children}</div>
    </ContentFrame>
  )
}
