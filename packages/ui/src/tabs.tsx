import { Tabs as BaseTabs } from '@base-ui-components/react/tabs'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from './lib/cn'

export function Tabs(props: ComponentPropsWithoutRef<typeof BaseTabs.Root>) {
  return <BaseTabs.Root {...props} />
}

export function TabsList({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-fill p-1',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        'relative h-7 rounded-sm px-2 text-caption text-subtle',
        'transition-[color,background-color,box-shadow] duration-150',
        'hover:text-ink',
        'data-[selected]:bg-raised data-[selected]:text-ink data-[selected]:font-medium',
        'data-[selected]:shadow-sm data-[selected]:ring-1 data-[selected]:ring-brand/40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseTabs.Panel>) {
  return (
    <BaseTabs.Panel className={cn('pt-4 text-ink', className)} {...props} />
  )
}
