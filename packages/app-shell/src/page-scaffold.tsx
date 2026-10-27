import type { ReactNode } from 'react'
import { cn } from '@obiter/ui'
import { ContentFrame } from './content-frame'

export interface PageScaffoldProps {
  title: ReactNode
  /** One line under the title: what the page is for, in a lawyer's terms. */
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}

/**
 * PageScaffold — the page title, description and header actions, on the frame's
 * content column. Screens compose it instead of building their own heading, so
 * every page starts on the same left edge with the same type and spacing.
 */
export function PageScaffold({
  title,
  description,
  actions,
  children,
  className,
}: PageScaffoldProps) {
  return (
    <ContentFrame className={cn('py-14', className)}>
      <header className="mb-10 flex items-center justify-between gap-6 max-compact:flex-col max-compact:items-stretch max-compact:gap-4">
        <div className="min-w-0">
          <h1 className="text-page text-ink">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-[68ch] text-body text-muted">
              {description}
            </p>
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
