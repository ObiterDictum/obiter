import type { TdHTMLAttributes, ThHTMLAttributes, HTMLAttributes } from 'react'
import { cn } from './lib/cn'

/**
 * Table — styled semantic table elements (no headless lib; native tables carry
 * the correct semantics). Use for dense, reviewable data.
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full border-collapse text-sm text-ink', className)}
      {...props}
    />
  )
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('border-b border-line-strong text-left text-xs uppercase tracking-wide text-subtle', className)}
      {...props}
    />
  )
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('[&>tr]:border-b [&>tr]:border-line', className)} {...props} />
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-surface', className)} {...props} />
}

export interface THProps extends Omit<ThHTMLAttributes<HTMLTableCellElement>, 'align'> {
  align?: 'start' | 'end'
}

export function TH({ className, align = 'start', ...props }: THProps) {
  return (
    <th
      className={cn('px-3 py-2 font-medium', align === 'end' && 'text-end', className)}
      {...props}
    />
  )
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-3 py-2.5', className)} {...props} />
}
