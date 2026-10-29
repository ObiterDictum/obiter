import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('min-w-0 rounded-lg bg-surface', className)}
      {...props}
    />
  )
}

export function CardHead({
  title,
  titleId,
  children,
  className,
}: {
  title: ReactNode
  titleId?: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 px-6 pt-6 pb-4',
        className,
      )}
    >
      <h2 id={titleId} className="text-item text-ink">
        {title}
      </h2>
      {children}
    </div>
  )
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />
}

export function CardFoot({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 border-t border-line px-6 py-3 text-caption text-subtle',
        className,
      )}
      {...props}
    />
  )
}
