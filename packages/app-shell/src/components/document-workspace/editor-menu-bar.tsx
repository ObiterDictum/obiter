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
  // A row that edits the document hands the caret back once its menu has
  // finished closing: the menu restores focus to its trigger, and a reader
  // who picked "Delete paragraph" expects the cursor in the text, not on the
  // Edit button.
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

/**
 * The rows of one group. A run of radio choices is its own `MenuRadioGroup`,
 * because a group can hold both a choice and plain actions (the Authorities
 * group names citation styles beside its commands); a radio group holding a
 * plain row would break the roving focus and the announced choice.
 */
function MenuGroupCommands({
  commands,
  onEdit,
}: {
  commands: readonly EditorCommand[]
  /** Told whether the row about to run leaves the document as the focus. */
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
          // The group's value is the checked row: a radio item reads its
          // checked state from the group, so omitting it would leave every
          // choice announcing "not checked".
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
