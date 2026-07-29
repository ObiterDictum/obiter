import { cn } from '@obiter/ui'

/**
 * Obiter mark — compact geometric “marginal aside” (spine + offset note).
 * Legal craft without gavels/scales. Uses currentColor for theme contrast.
 */
export function ObiterMark({
  className,
  title = 'Obiter',
}: {
  className?: string
  title?: string
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0 text-ink', className)}
      role="img"
      aria-label={title}
    >
      <path
        fill="currentColor"
        d="M7 4h5.5c.8 0 1.5.7 1.5 1.5v21c0 .8-.7 1.5-1.5 1.5H7c-.8 0-1.5-.7-1.5-1.5v-21C5.5 4.7 6.2 4 7 4zm12.2 6.5h6.3c.8 0 1.5.7 1.5 1.5v8c0 .8-.7 1.5-1.5 1.5h-6.3c-.8 0-1.5-.7-1.5-1.5v-8c0-.8.7-1.5 1.5-1.5z"
      />
    </svg>
  )
}

/**
 * Brand wordmark — mark + OBITER type. currentColor tracks the theme.
 * Used by the shell, loading state, and auth screens.
 */
export function Wordmark({
  className,
  markOnly = false,
}: {
  className?: string
  /** Compact mark only (top-bar / home icon). */
  markOnly?: boolean
}) {
  if (markOnly) {
    return <ObiterMark className={cn('h-7 w-7', className)} />
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 text-ink',
        className,
      )}
      role="img"
      aria-label="Obiter"
    >
      <ObiterMark className="h-[1.15em] w-[1.15em]" title="" />
      <span className="text-[0.95em] font-semibold tracking-[0.14em]">
        OBITER
      </span>
    </span>
  )
}
