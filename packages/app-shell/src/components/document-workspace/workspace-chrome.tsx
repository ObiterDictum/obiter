import type { KeyboardEventHandler, ReactNode } from 'react'
import { Button, EmptyState, Skeleton } from '@obiter/ui'
import { ApiError } from '../../api'

export type DocumentWorkspaceLayout = 'page' | 'pane'

export function WorkspaceShell({
  children,
  onKeyDown,
  layout = 'page',
}: {
  children: ReactNode
  onKeyDown?: KeyboardEventHandler<HTMLElement>
  layout?: DocumentWorkspaceLayout
}) {
  const pane = layout === 'pane'
  return (
    <section
      id="document-workspace"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className={
        pane
          ? 'flex h-full min-h-0 flex-col'
          : 'flex min-h-[32rem] flex-col rounded-lg border border-line bg-canvas'
      }
    >
      {pane ? null : (
        <div className="sr-only">
          <h2>Document</h2>
        </div>
      )}
      {children}
    </section>
  )
}

export function WorkspaceRibbon({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-b border-line bg-surface px-3 py-2">
      {children}
    </div>
  )
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div
      className="flex justify-center px-4 py-8"
      aria-busy="true"
      aria-label={label}
    >
      <div className="h-[min(70vh,1123px)] w-[min(100%,794px)] bg-[#fcfcfa] shadow-[0_12px_40px_rgba(0,0,0,0.38)]">
        <div className="flex flex-col gap-3 p-24">
          <Skeleton className="h-4 w-2/3 bg-black/10" />
          <Skeleton className="h-4 w-full bg-black/10" />
          <Skeleton className="h-4 w-5/6 bg-black/10" />
        </div>
      </div>
    </div>
  )
}

export function QueryError({
  error,
  fallback,
}: {
  error: unknown
  fallback: string
}) {
  return (
    <EmptyState
      title="Could not open this document"
      body={error instanceof ApiError ? error.message : fallback}
    />
  )
}

export function ConflictBanner({
  body,
  actionLabel,
  onAction,
}: {
  body: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-md bg-warning/15 px-3 py-2"
      role="status"
    >
      <p className="text-sm text-ink">{body}</p>
      <Button variant="secondary" size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  )
}

export function mutationError(error: unknown) {
  if (!error) return null
  return error instanceof ApiError ? error.message : 'The request failed.'
}
