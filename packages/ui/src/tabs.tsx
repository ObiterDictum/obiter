import { Tabs as BaseTabs } from '@base-ui-components/react/tabs'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from './lib/cn'

/**
 * Tabs — a styled compound over Base UI Tabs. Keyboard roving + focus from Base UI.
 *
 *   <Tabs defaultValue="a">
 *     <TabsList>
 *       <TabsTrigger value="a">A</TabsTrigger>
 *       <TabsTrigger value="b">B</TabsTrigger>
 *     </TabsList>
 *     <TabsContent value="a">…</TabsContent>
 *     <TabsContent value="b">…</TabsContent>
 *   </Tabs>
 */
export function Tabs(props: ComponentPropsWithoutRef<typeof BaseTabs.Root>) {
  return <BaseTabs.Root {...props} />
}

export function TabsList(
  props: ComponentPropsWithoutRef<typeof BaseTabs.List>,
) {
  return (
    <BaseTabs.List
      className="inline-flex items-center gap-1 rounded-md bg-canvas p-1"
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
        'relative rounded-md px-3 py-1.5 text-sm font-medium text-muted',
        'transition-[color,background-color] duration-200',
        'hover:text-ink',
        'data-[selected]:bg-raised data-[selected]:text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
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
