import type { ReactNode } from 'react'
import { cn } from '@obiter/ui'
import { ContentFrame } from './content-frame'
import { PagePanelToggle } from './page-panel'

export interface PageScaffoldProps {
  title: ReactNode
  eyebrow?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  compact?: boolean
}

export function PageScaffold({
  title,
  eyebrow,
  description,
  actions,
  children,
  className,
  compact = false,
}: PageScaffoldProps) {
  return (
    <ContentFrame className={cn(compact ? 'py-8' : 'py-14', className)}>
      {compact ? (
        <header className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 @max-pane-wide:flex-col @max-pane-wide:items-stretch">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="min-w-0 truncate text-section text-ink">{title}</h1>
            <PagePanelToggle />
            {eyebrow ? (
              <p className="flex flex-wrap items-center gap-2 text-meta text-subtle">
                {eyebrow}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-1 @max-pane-wide:justify-start">
              {actions}
            </div>
          ) : null}
        </header>
      ) : (
        <header className="mb-10 flex flex-wrap items-start justify-between gap-x-6 gap-y-4 @max-pane-wide:flex-col @max-pane-wide:flex-nowrap @max-pane-wide:items-stretch @max-pane-wide:gap-4">
          <div className="min-w-0 flex-1">
            {eyebrow ? (
              <p className="mb-1 text-meta text-subtle">{eyebrow}</p>
            ) : null}
            <div className="flex min-w-0 items-center gap-3">
              <h1 className="min-w-0 text-page text-ink [text-wrap:balance]">
                {title}
              </h1>
              <PagePanelToggle />
            </div>
            {description ? (
              <div className="mt-2 max-w-[68ch] text-body text-muted">
                {description}
              </div>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-2 @max-pane-wide:justify-start">
              {actions}
            </div>
          ) : null}
        </header>
      )}
      <div className="flex flex-col gap-10">{children}</div>
    </ContentFrame>
  )
}
