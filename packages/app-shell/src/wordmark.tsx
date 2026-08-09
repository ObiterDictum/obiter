import { cn } from '@obiter/ui'

/**
 * Obiter logo — flip-proof comma mark.
 * Upright: dictum comma with O counter. Rotated 180°: lowercase b.
 * Uses currentColor for theme contrast.
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
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0 text-ink', className)}
      role="img"
      aria-label={title}
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M25.96 3.00 L46.76 3.10 L48.01 3.96 L48.39 4.82 L48.39 36.94 L47.91 38.85 L45.61 42.98 L40.44 49.30 L32.77 56.88 L29.12 59.95 L27.40 61.00 L26.63 60.71 L26.73 59.27 L33.63 45.57 L36.03 39.72 L36.60 36.27 L36.60 32.14 L18.67 32.05 L17.43 31.66 L16.47 30.90 L15.89 29.94 L15.61 28.69 L15.61 12.59 L16.47 8.94 L18.20 6.26 L20.40 4.44 L23.56 3.19 L25.86 3.10 Z M23.01 17.41 a8.34 8.34 0 1 0 16.68 0 a8.34 8.34 0 1 0 -16.68 0 Z"
      />
    </svg>
  )
}

/**
 * Brand lockup — logo mark + OBITER type (type is not the logo).
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
      className={cn('inline-flex items-center gap-2.5 text-ink', className)}
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
