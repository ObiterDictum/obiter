import { Fragment, useRef } from 'react'
import {
  Button,
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuTrigger,
  cn,
} from '@obiter/ui'
import { EditorMenuItem } from './editor-controls'
import { refocusCaret } from './document-actions'
import type { EditorCommand, EditorMenu } from './editor-commands'

export function EditorMenuBar({
  menus,
  className,
}: {
  menus: readonly EditorMenu[]
  className?: string
}) {
  const refocusAfterClose = useRef(false)
  return (
    <nav
      aria-label="Document menu"
      className={cn('flex items-stretch', className)}
    >
      {menus.map((menu) => (
        <Menu
          key={menu.id}
          modal={false}
          onOpenChangeComplete={(open) => {
            if (open || !refocusAfterClose.current) return
            refocusAfterClose.current = false
            refocusCaret()
          }}
        >
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
                <MenuGroupCommands
                  commands={group.commands}
                  onEdit={(command) => {
                    refocusAfterClose.current =
                      !command.stayOpen && !command.opensSurface
                  }}
                />
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
  onEdit,
}: {
  commands: readonly EditorCommand[]
  onEdit: (command: EditorCommand) => void
}) {
  const segments: Array<{
    kind: 'radio' | 'plain'
    commands: EditorCommand[]
  }> = []
  for (const command of commands) {
    const kind = command.checked !== undefined ? 'radio' : 'plain'
    const tail = segments[segments.length - 1]
    if (tail && tail.kind === kind) tail.commands.push(command)
    else segments.push({ kind, commands: [command] })
  }
  return (
    <>
      {segments.map((segment) => {
        const rows = segment.commands.map((command) => (
          <EditorMenuItem
            key={command.id}
            kind={segment.kind === 'radio' ? 'radio' : undefined}
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
            onSelect={
              command.run
                ? () => {
                    onEdit(command)
                    command.run?.()
                  }
                : undefined
            }
          />
        ))
        const first = segment.commands[0]
        if (segment.kind === 'radio') {
          const selected = segment.commands.find(
            (command) => command.checked === true,
          )
          return (
            <MenuRadioGroup
              key={`radio-${first?.id ?? ''}`}
              value={selected?.label ?? null}
            >
              {rows}
            </MenuRadioGroup>
          )
        }
        return <Fragment key={`plain-${first?.id ?? ''}`}>{rows}</Fragment>
      })}
    </>
  )
}
