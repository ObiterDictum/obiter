import { Fragment } from 'react'
import {
  Button,
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuTrigger,
  cn,
} from '@obiter/ui'
import { EditorMenuItem } from './editor-controls'
import type { EditorCommand, EditorMenu } from './editor-commands'

/**
 * The editor's menu bar. Every command the old ribbon held is a row in one of
 * six menus, so the chrome is one 32px row instead of six tab panels. The
 * menus are non-modal: the document stays visible and editable behind them.
 *
 * A row that flips state keeps its menu open (`stayOpen`), which is what makes
 * a menu usable for the repetitive parts of review — track changes, lists,
 * alignment — rather than a one-shot list.
 */
export function EditorMenuBar({
  menus,
  className,
}: {
  menus: readonly EditorMenu[]
  className?: string
}) {
  return (
    <nav
      aria-label="Document menu"
      className={cn('flex items-stretch', className)}
    >
      {menus.map((menu) => (
        <Menu key={menu.id} modal={false}>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-none px-2.5 text-caption text-muted hover:text-ink data-[popup-open]:bg-hover data-[popup-open]:text-ink pointer-coarse:h-11"
              />
            }
          >
            {menu.label}
          </MenuTrigger>
          <MenuContent
            align="start"
            aria-label={menu.label}
            className="max-h-[min(70vh,36rem)] w-96 overflow-y-auto p-1"
          >
            {menu.groups.map((group) => (
              <Fragment key={group.label}>
                <p className="px-3 pt-2 pb-1 text-caption text-subtle">
                  {group.label}
                </p>
                <MenuGroupCommands commands={group.commands} />
              </Fragment>
            ))}
          </MenuContent>
        </Menu>
      ))}
    </nav>
  )
}

function MenuGroupCommands({
  commands,
}: {
  commands: readonly EditorCommand[]
}) {
  const rows = commands.map((command) => (
    <EditorMenuItem
      key={command.id}
      label={command.label}
      icon={command.icon}
      hint={command.hint}
      shortcut={command.shortcut}
      pressed={command.pressed}
      checked={command.checked}
      disabled={command.disabled}
      disabledReason={command.disabledReason}
      soon={command.soon}
      closeOnClick={!command.stayOpen}
      onSelect={command.run}
    />
  ))
  // A group with a checked row is a radio set: the checked row and its
  // siblings announce which choice is current, and a plain row in the same
  // group is an action that leaves the choice alone.
  if (commands.some((command) => command.checked !== undefined)) {
    return <MenuRadioGroup>{rows}</MenuRadioGroup>
  }
  return <>{rows}</>
}
