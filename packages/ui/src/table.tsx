import type { TdHTMLAttributes, ThHTMLAttributes, HTMLAttributes } from 'react'
import { cn } from './lib/cn'

export function Table({
  className,
  ...props
}: HTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn('w-full border-collapse text-meta text-ink', className)}
      {...props}
    />
  )
}

export function THead({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        'border-b border-line text-left text-caption text-subtle',
        className,
      )}
      {...props}
    />
  )
}

export function TBody({
  className,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn(
        '[&>tr]:border-b [&>tr]:border-line last:[&>tr]:border-0',
        className,
      )}
      {...props}
    />
  )
}

export function TR({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn('h-row transition-colors hover:bg-hover', className)}
      {...props}
    />
  )
}

export interface THProps extends Omit<
  ThHTMLAttributes<HTMLTableCellElement>,
  'align'
> {
  align?: 'start' | 'end'
}

export function TH({ className, align = 'start', ...props }: THProps) {
  return (
    <th
      className={cn(
        'px-6 pb-3 font-normal',
        align === 'end' && 'text-end',
        className,
      )}
      {...props}
    />
  )
}

export function TD({
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-6 py-4', className)} {...props} />
}
