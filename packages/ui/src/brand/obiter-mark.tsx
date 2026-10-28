import { cn } from '../lib/cn'

/**
 * The Obiter monogram — the approved "ob" mark from `final/icons.svg#i-obiter`.
 * Markup rather than the brand file so it inherits `currentColor` and tracks
 * the theme. Decorative when the surrounding link or heading already names
 * Obiter: pass `title=""`.
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
      viewBox="0 0 26 26"
      fill="none"
      role="img"
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0 text-ink', className)}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <circle cx="7.75" cy="14.6" r="4.9" />
        <path d="M18.25 3.4v16.1" />
        <path d="M18.25 9.7a4.9 4.9 0 0 1 0 9.8" />
      </g>
    </svg>
  )
}
