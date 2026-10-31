import { Link } from '@tanstack/react-router'
import { Button, ObiterMark, Skeleton, cn } from '@obiter/ui'
import {
  ArrowClockwise,
  House,
  Lock,
  MagnifyingGlass,
  Warning,
} from '@obiter/ui/icons/shell'
import { useSyncExternalStore, type ReactNode } from 'react'
import { ApiError } from './api'
import { ContentFrame } from './content-frame'

function subscribeOffline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

export function useOffline(): boolean {
  return useSyncExternalStore(
    subscribeOffline,
    () => !window.navigator.onLine,
    () => false,
  )
}

export function ShellOfflineBanner() {
  const offline = useOffline()
  if (!offline) return null
  return (
    <ContentFrame className="pt-6">
      <div
        role="status"
        className="flex items-start gap-3 rounded-lg bg-warning-soft px-4 py-3"
      >
        <Warning size={16} aria-hidden className="mt-1 shrink-0 text-warning" />
        <div className="min-w-0">
          <p className="text-item text-ink">You are offline</p>
          <p className="mt-1 text-caption text-muted">
            Obiter cannot reach the server. Pages already open stay readable;
            saving, uploads and search will fail until the connection returns.
          </p>
        </div>
      </div>
    </ContentFrame>
  )
}

export function ShellBootLoading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas">
      <ObiterMark className="size-7" />
      <p role="status" className="text-meta text-muted">
        Checking your session…
      </p>
      <Skeleton className="h-1 w-24" />
    </div>
  )
}

const NOT_FOUND_CODES = new Set([
  'matter_not_found',
  'matter_share_not_found',
  'document_not_found',
  'document_version_not_found',
  'redaction_run_not_found',
  'output_not_found',
  'span_not_found',
  'verification_run_not_found',
  'invite_not_found',
])

export type ShellFailure = 'error' | 'not-found' | 'forbidden'

export function classifyShellFailure(error: unknown): ShellFailure {
  if (!(error instanceof ApiError)) return 'error'
  if (error.code === 'forbidden' || error.code === 'no_organisation')
    return 'forbidden'
  if (NOT_FOUND_CODES.has(error.code)) return 'not-found'
  return 'error'
}

const linkClass = {
  primary:
    'inline-flex h-control items-center gap-2 rounded-md bg-brand px-3 text-item text-brand-fg hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  secondary:
    'inline-flex h-control items-center gap-2 rounded-md bg-fill px-3 text-item text-ink hover:bg-fill-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
  ghost:
    'inline-flex h-control items-center gap-2 rounded-md px-3 text-item text-muted hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
} satisfies Record<'primary' | 'secondary' | 'ghost', string>

const toneClasses = {
  neutral: 'bg-fill text-muted',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} satisfies Record<'neutral' | 'warning' | 'danger', string>

function StatePage({
  tone,
  icon,
  title,
  description,
  actions,
  footer,
}: {
  tone: keyof typeof toneClasses
  icon: ReactNode
  title: string
  description: ReactNode
  actions: ReactNode
  footer?: ReactNode
}) {
  return (
    <ContentFrame className="flex min-h-full flex-col items-center justify-center py-12 text-center">
      <span
        aria-hidden
        className={cn(
          'grid size-10 place-items-center rounded-lg',
          toneClasses[tone],
        )}
      >
        {icon}
      </span>
      <h1 className="mt-6 max-w-[30ch] text-page text-ink">{title}</h1>
      <p className="mt-3 max-w-[48ch] text-body text-muted">{description}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {actions}
      </div>
      {footer ? (
        <p className="mt-6 max-w-[44ch] text-caption text-subtle">{footer}</p>
      ) : null}
    </ContentFrame>
  )
}

export function ShellNotFound() {
  return (
    <StatePage
      tone="neutral"
      icon={<MagnifyingGlass size={20} aria-hidden />}
      title="We cannot find that page"
      description="The link may be out of date, or the page may have moved. Nothing in your matters has changed."
      actions={
        <>
          <Link to="/" className={linkClass.primary}>
            Go to Home
          </Link>
          <Link to="/matters" className={linkClass.secondary}>
            Open your matters
          </Link>
        </>
      }
      footer="Check the address, or use the sidebar to reach the page you need."
    />
  )
}

export function ShellPermissionDenied() {
  return (
    <StatePage
      tone="warning"
      icon={<Lock size={20} aria-hidden />}
      title="You do not have access to this page"
      description="This page is restricted in your organisation. Ask the team that owns it to approve your access."
      actions={
        <>
          <Link to="/matters" className={linkClass.primary}>
            Back to matters
          </Link>
          <Link to="/" className={linkClass.secondary}>
            Go to Home
          </Link>
        </>
      }
    />
  )
}

export function ShellError({
  error,
  reset,
}: {
  error: unknown
  reset?: () => void
}) {
  const failure = classifyShellFailure(error)
  if (failure === 'not-found') return <ShellNotFound />
  if (failure === 'forbidden') return <ShellPermissionDenied />

  return (
    <StatePage
      tone="danger"
      icon={<Warning size={20} aria-hidden />}
      title="This page did not load"
      description="Something went wrong at our end. Nothing you had saved was changed."
      actions={
        <>
          <Button
            type="button"
            onClick={reset}
            disabled={!reset}
            iconStart={<ArrowClockwise size={16} />}
          >
            Try again
          </Button>
          <Link to="/" className={linkClass.secondary}>
            <House size={16} aria-hidden />
            Go to Home
          </Link>
        </>
      }
      footer="If this keeps happening, tell your administrator."
    />
  )
}
