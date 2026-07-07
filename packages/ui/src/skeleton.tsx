import { cn } from './lib/cn'

export interface SkeletonProps {
  className?: string
}

/** Skeleton — a shimmering placeholder matching the layout of pending content. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-line',
        'bg-[linear-gradient(110deg,transparent_35%,var(--color-line-strong)_50%,transparent_65%)]',
        'bg-[length:200%_100%]',
        className,
      )}
      aria-hidden="true"
    />
  )
}
