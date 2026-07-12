import { createPortal } from 'react-dom'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from '@phosphor-icons/react'
import { cn } from './lib/cn'

export type ToastTone = 'info' | 'success' | 'warning' | 'danger'

export interface ToastInput {
  title: ReactNode
  description?: ReactNode
  tone?: ToastTone
  /** ms before auto-dismiss. 0 keeps it until dismissed. Default 5000. */
  timeout?: number
}

interface ToastRecord {
  id: string
  title: ReactNode
  description?: ReactNode
  tone: ToastTone
  timeout: number
}

interface ToastContextValue {
  toasts: ToastRecord[]
  toast: (input: ToastInput) => string
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const toneAccent: Record<ToastTone, string> = {
  info: 'before:bg-info',
  success: 'before:bg-success',
  warning: 'before:bg-warning',
  danger: 'before:bg-danger',
}

const DEFAULT_TIMEOUT = 5000

/**
 * Toast — accessible notifications. The frame wraps the app in <ToastProvider>
 * and mounts <Toaster /> once; feature screens call useToast().
 *
 * NOTE: self-contained rather than Base UI's toast manager. Base UI 1.0.0-rc.0
 * does not export the manager hooks (useToastManager/createToastManager) as
 * runtime values from the toast module, so we ship a lightweight, accessible
 * implementation (aria-live region, per-toast timer) that matches the contract.
 * Revisit when Base UI's toast API stabilises.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const toast = useCallback((input: ToastInput) => {
    counter.current += 1
    const id = `toast-${counter.current}`
    setToasts((current) => [
      ...current,
      {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? 'info',
        timeout: input.timeout ?? DEFAULT_TIMEOUT,
      },
    ])
    return id
  }, [])

  const value = useMemo(
    () => ({ toasts, toast, dismiss }),
    [toasts, toast, dismiss],
  )

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>
}

export interface UseToastReturn {
  toast: (input: ToastInput) => string
  dismiss: (id: string) => void
}

export function useToast(): UseToastReturn {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within <ToastProvider>.')
  }
  return { toast: context.toast, dismiss: context.dismiss }
}

/** Renders the notification viewport. Mount once inside <ToastProvider>. */
export function Toaster() {
  const context = useContext(ToastContext)
  if (
    !context ||
    context.toasts.length === 0 ||
    typeof document === 'undefined'
  ) {
    return null
  }

  return createPortal(
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,22rem)] flex-col gap-2"
      role="region"
      aria-label="Notifications"
    >
      {context.toasts.map((record) => (
        <ToastItem
          key={record.id}
          record={record}
          onDismiss={context.dismiss}
        />
      ))}
    </div>,
    document.body,
  )
}

function ToastItem({
  record,
  onDismiss,
}: {
  record: ToastRecord
  onDismiss: (id: string) => void
}) {
  const isDanger = record.tone === 'danger'

  // Auto-dismiss timer — a legitimate external-timer use of useEffect.
  useEffect(() => {
    if (record.timeout <= 0) return
    const timer = window.setTimeout(() => onDismiss(record.id), record.timeout)
    return () => window.clearTimeout(timer)
  }, [record.id, record.timeout, onDismiss])

  return (
    <div
      role={isDanger ? 'alert' : 'status'}
      aria-live={isDanger ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-md border border-line bg-raised p-3 pr-9 shadow-md',
        'before:absolute before:bottom-0 before:left-0 before:top-0 before:w-1',
        toneAccent[record.tone],
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-semibold text-ink">{record.title}</p>
        {record.description ? (
          <p className="text-xs leading-relaxed text-muted">
            {record.description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(record.id)}
        className="absolute right-2 top-2 rounded p-1 text-subtle hover:bg-surface hover:text-ink"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
