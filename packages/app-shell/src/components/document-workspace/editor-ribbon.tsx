import {
  Fragment,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  Menu,
  MenuContent,
  MenuRadioGroup,
  MenuTrigger,
  StatusDot,
  cn,
} from '@obiter/ui'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Command,
  FloppyDisk,
} from '@obiter/ui/icons'
import { formatShortcut, shortcutAttribute } from '../../keyboard-platform'
import {
  EditorIconButton,
  EditorMenuItem,
  EditorSelect,
  EditorTextButton,
} from './editor-controls'
import { refocusCaret } from './document-actions'
import type {
  EditorChromeProps,
  EditorCommand,
  EditorMenu,
  EditorMenuGroup,
  EditorMenuId,
} from './editor-commands'

const FILE_MENU_ID: EditorMenuId = 'file'
const DEFAULT_TAB_ID: EditorMenuId = 'format'

type EditorRibbonProps = {
  menus: readonly EditorMenu[]
  props: EditorChromeProps
  onOpenPalette: () => void
}

function tabClassName(selected: boolean) {
  return cn(
    'inline-flex h-7 items-center rounded-sm px-2.5 text-caption whitespace-nowrap transition-colors duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    selected ? 'bg-fill text-ink' : 'text-muted hover:bg-hover hover:text-ink',
    'data-[popup-open]:bg-fill data-[popup-open]:text-ink',
  )
}

export function EditorRibbon({
  menus,
  props,
  onOpenPalette,
}: EditorRibbonProps) {
  const tabs = menus.filter((menu) => menu.id !== FILE_MENU_ID)
  const fileMenu = menus.find((menu) => menu.id === FILE_MENU_ID)
  const [selectedId, setSelectedId] = useState<EditorMenuId>(
    tabs.some((menu) => menu.id === DEFAULT_TAB_ID)
      ? DEFAULT_TAB_ID
      : (tabs[0]?.id ?? DEFAULT_TAB_ID),
  )
  const tabRefs = useRef(new Map<EditorMenuId, HTMLButtonElement>())
  const active = tabs.find((menu) => menu.id === selectedId) ?? tabs[0]

  const selectTab = (id: EditorMenuId, keepTabFocus: boolean) => {
    setSelectedId(id)
    if (keepTabFocus) tabRefs.current.get(id)?.focus()
    else refocusCaret()
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!active) return
    const index = tabs.findIndex((menu) => menu.id === active.id)
    const next = nextTabIndex(event.key, index, tabs.length)
    if (next === undefined) return
    const target = tabs[next]
    if (!target) return
    event.preventDefault()
    selectTab(target.id, true)
  }

  return (
    <div className="shrink-0 bg-surface">
      <div className="flex items-center gap-1 border-b border-line px-3 py-1">
        {fileMenu ? <FileMenu menu={fileMenu} /> : null}
        <div
          role="tablist"
          aria-label="Ribbon tabs"
          className="flex items-center gap-0.5"
          onKeyDown={onTabKeyDown}
        >
          {tabs.map((menu) => {
            const selected = menu.id === active?.id
            return (
              <button
                key={menu.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(menu.id, node)
                  else tabRefs.current.delete(menu.id)
                }}
                type="button"
                role="tab"
                id={tabId(menu.id)}
                aria-selected={selected}
                aria-controls={panelId(menu.id)}
                tabIndex={selected ? 0 : -1}
                className={tabClassName(selected)}
                onClick={(event) => selectTab(menu.id, event.detail === 0)}
              >
                {menu.label}
              </button>
            )
          })}
        </div>
      </div>
      <div
        data-editor-toolbar
        role="toolbar"
        aria-label="Document toolbar"
        className="flex min-w-0 items-stretch gap-2 overflow-x-auto border-b border-line px-3 py-1"
      >
        <RibbonQuickAccess props={props} />
        <ToolbarDivider />
        {active ? (
          <div
            role="tabpanel"
            id={panelId(active.id)}
            aria-labelledby={tabId(active.id)}
            className="flex shrink-0 items-stretch gap-1"
          >
            {active.groups.map((group) => (
              <RibbonGroup key={group.label} group={group} />
            ))}
          </div>
        ) : null}
        <div className="ms-auto flex shrink-0 items-center gap-1">
          {props.trackChanges ? (
            <span
              data-track-changes="on"
              className="inline-flex shrink-0 items-center rounded-sm bg-fill px-2 py-1"
            >
              <StatusDot tone="info" className="text-caption">
                Track changes on
              </StatusDot>
            </span>
          ) : null}
          <EditorIconButton
            label="All commands"
            hint={`All commands (${formatShortcut(['primary', 'K'])})`}
            onClick={onOpenPalette}
            icon={<Command size={16} aria-hidden />}
          />
        </div>
      </div>
    </div>
  )
}

function nextTabIndex(key: string, index: number, count: number) {
  if (count === 0) return undefined
  if (key === 'ArrowRight') return (index + 1) % count
  if (key === 'ArrowLeft') return (index - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return undefined
}

function tabId(id: EditorMenuId) {
  return `ribbon-tab-${id}`
}

function panelId(id: EditorMenuId) {
  return `ribbon-panel-${id}`
}

function RibbonQuickAccess({ props }: { props: EditorChromeProps }) {
  return (
    <div
      role="group"
      aria-label="Quick access"
      className="flex shrink-0 items-center gap-1"
    >
      <EditorIconButton
        label="Save"
        hint={`Save (${formatShortcut(['primary', 'S'])})`}
        disabled={!props.canSave}
        disabledReason={props.saveReason}
        onClick={props.onSave}
        icon={<FloppyDisk size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Undo"
        hint={`Undo (${formatShortcut(['primary', 'Z'])})`}
        disabled={!props.canEdit || !props.canUndo}
        onClick={props.onUndo}
        icon={<ArrowCounterClockwise size={16} aria-hidden />}
      />
      <EditorIconButton
        label="Redo"
        hint={`Redo (${formatShortcut(['primary', 'shift', 'Z'])})`}
        disabled={!props.canEdit || !props.canRedo}
        onClick={props.onRedo}
        icon={<ArrowClockwise size={16} aria-hidden />}
      />
    </div>
  )
}

function ToolbarDivider() {
  return (
    <div className="mx-1 h-5 w-px shrink-0 self-center bg-line" aria-hidden />
  )
}

function RibbonGroup({ group }: { group: EditorMenuGroup }) {
  const commands = group.commands.filter(
    (command) => command.host === undefined,
  )
  const selected = commands.filter((command) => command.checked !== undefined)
  const buttons = commands.filter((command) => command.checked === undefined)
  if (!group.select && buttons.length === 0) return null
  return (
    <div className="flex shrink-0 flex-col justify-center gap-0.5 border-e border-line px-2 last:border-e-0">
      <div className="flex items-center gap-1">
        {group.select ? (
          <EditorSelect
            label={group.select.label ?? group.label}
            className="w-34"
            value={selected.find((command) => command.checked)?.id ?? ''}
            options={selected.map((command) => ({
              value: command.id,
              label: command.label,
            }))}
            placeholder={group.select.placeholder}
            disabled={selected.every(isUnavailable)}
            disabledReason={
              selected.find((command) => command.disabled)?.disabledReason
            }
            onChange={(id) => {
              const command = selected.find((item) => item.id === id)
              if (command) runCommand(command)
            }}
          />
        ) : null}
        {buttons.map((command) => (
          <RibbonCommand key={command.id} command={command} />
        ))}
      </div>
      <span className="px-1 text-caption text-subtle">{group.label}</span>
    </div>
  )
}

function isUnavailable(command: EditorCommand) {
  return Boolean(command.disabled || command.soon)
}

function runCommand(command: EditorCommand) {
  if (isUnavailable(command)) return
  command.run?.()
}

function RibbonCommand({ command }: { command: EditorCommand }) {
  const hint = commandHint(command)
  const keyshortcuts = command.shortcut
    ? shortcutAttribute(command.shortcut)
    : undefined
  if (command.icon) {
    return (
      <EditorIconButton
        label={command.label}
        pressed={command.pressed}
        disabled={command.disabled}
        soon={command.soon}
        disabledReason={command.disabledReason}
        hint={hint}
        keyshortcuts={keyshortcuts}
        onClick={command.run}
        icon={command.icon}
      />
    )
  }
  return (
    <EditorTextButton
      label={command.label}
      status={command.status}
      pressed={command.pressed}
      disabled={command.disabled}
      soon={command.soon}
      disabledReason={command.disabledReason}
      hint={hint}
      keyshortcuts={keyshortcuts}
      onClick={command.run}
      className="max-w-none"
    />
  )
}

function commandHint(command: EditorCommand): string | undefined {
  const shortcut = command.shortcut
    ? formatShortcut(command.shortcut)
    : undefined
  const label = shortcut ? `${command.label} (${shortcut})` : command.label
  if (command.hint)
    return shortcut ? `${command.hint} (${shortcut})` : command.hint
  return shortcut ? label : undefined
}

function FileMenu({ menu }: { menu: EditorMenu }) {
  const refocusAfterClose = useRef(false)
  return (
    <Menu
      modal={false}
      onOpenChangeComplete={(open) => {
        if (open || !refocusAfterClose.current) return
        refocusAfterClose.current = false
        refocusCaret()
      }}
    >
      <MenuTrigger
        render={
          <button type="button" className={cn(tabClassName(false), 'me-1')} />
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
        const rows: ReactNode[] = segment.commands.map((command) => (
          <EditorMenuItem
            key={command.id}
            kind={segment.kind === 'radio' ? 'radio' : undefined}
            label={command.label}
            status={command.status}
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
          const checked = segment.commands.find(
            (command) => command.checked === true,
          )
          return (
            <MenuRadioGroup
              key={`radio-${first?.id ?? ''}`}
              value={checked?.label ?? null}
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
