import { cn } from './lib/cn'

export interface SkeletonProps {
  className?: string
}

/** Static so a failed owner cannot leave a perpetual loading animation. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div className={cn('rounded-md bg-fill', className)} aria-hidden="true" />
  )
}
