import { Menu as BaseMenu } from '@base-ui-components/react/menu'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from './lib/cn'

/**
 * Menu — a styled compound over Base UI Menu. The menu/menuitem roles, focus
 * movement, typeahead, and Escape-returns-focus-to-the-trigger contract come
 * from Base UI; we own the visual layer. It portals the popup so a menu inside
 * clipped chrome (the shell's top bar) is positioned and stacked by the
 * positioner rather than by its ancestor's overflow.
 *
 *   <Menu>
 *     <MenuTrigger render={<Button aria-label="Account menu">AM</Button>} />
 *     <MenuContent aria-label="Account">
 *       <MenuItem onClick={signOut}>Sign out</MenuItem>
 *     </MenuContent>
 *   </Menu>
 */
export function Menu(props: ComponentPropsWithoutRef<typeof BaseMenu.Root>) {
  return <BaseMenu.Root {...props} />
}

export function MenuTrigger(
  props: ComponentPropsWithoutRef<typeof BaseMenu.Trigger>,
) {
  return <BaseMenu.Trigger {...props} />
}

export function MenuContent({
  className,
  align = 'end',
  ...props
}: ComponentPropsWithoutRef<typeof BaseMenu.Popup> & {
  /** Which trigger edge the popup lines up with; a menu bar uses `start`. */
  align?: 'start' | 'center' | 'end'
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner sideOffset={8} align={align} className="z-50">
        <BaseMenu.Popup
          className={cn(
            'w-72 rounded-lg border border-line bg-raised p-2 text-ink shadow-lg outline-none',
            'transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none',
            'data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0',
            'data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export function MenuItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseMenu.Item>) {
  return (
    <BaseMenu.Item
      className={cn(
        'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-left text-item text-muted select-none',
        'pointer-coarse:min-h-11',
        'data-[highlighted]:bg-hover data-[highlighted]:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function MenuSeparator({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseMenu.Separator>) {
  return (
    <BaseMenu.Separator
      className={cn('my-1 h-px bg-line', className)}
      {...props}
    />
  )
}

/** A group of mutually exclusive menu items, such as the paragraph styles. */
export function MenuRadioGroup(
  props: ComponentPropsWithoutRef<typeof BaseMenu.RadioGroup>,
) {
  return <BaseMenu.RadioGroup {...props} />
}

/** A menu row that flips a setting on or off: `menuitemcheckbox`. */
export function MenuCheckboxItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseMenu.CheckboxItem>) {
  return (
    <BaseMenu.CheckboxItem
      className={cn(
        'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-left text-item text-muted select-none',
        'pointer-coarse:min-h-11',
        'data-[highlighted]:bg-hover data-[highlighted]:text-ink',
        'data-[checked]:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function MenuRadioItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof BaseMenu.RadioItem>) {
  return (
    <BaseMenu.RadioItem
      className={cn(
        'flex cursor-default items-center gap-3 rounded-md px-3 py-2 text-left text-item text-muted select-none',
        'pointer-coarse:min-h-11',
        'data-[highlighted]:bg-hover data-[highlighted]:text-ink',
        'data-[checked]:text-ink',
        className,
      )}
      {...props}
    />
  )
}
