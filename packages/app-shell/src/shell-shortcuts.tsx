import { KeyboardHint } from '@obiter/ui'
import { useEffect, useRef } from 'react'
import {
  isPrimaryModifier,
  shortcutLabels,
  useIsMacPlatform,
} from './keyboard-platform'
import type { ModuleId } from './navigation'

export type ShellCommand =
  | 'open-palette'
  | 'toggle-nav'
  | 'toggle-right-slot'
  | 'focus-mode'
  | 'go-home'
  | 'go-matters'
  | 'go-verify'
  | 'go-redact'
  | 'go-search'
  | 'go-agent'

const COMMAND_KEYS = {
  'open-palette': ['primary', 'K'],
  'toggle-nav': ['primary', '\\'],
  'toggle-right-slot': ['primary', 'J'],
  'focus-mode': ['primary', '.'],
  'go-home': ['g', 'h'],
  'go-matters': ['g', 'm'],
  'go-verify': ['g', 'v'],
  'go-redact': ['g', 'r'],
  'go-search': ['g', 's'],
  'go-agent': ['g', 'a'],
} satisfies Record<ShellCommand, readonly string[]>

const PRIMARY_KEYS = new Map<string, ShellCommand>([
  ['k', 'open-palette'],
  ['\\', 'toggle-nav'],
  ['j', 'toggle-right-slot'],
  ['.', 'focus-mode'],
])

const SEQUENCE_KEYS = new Map<string, ShellCommand>([
  ['h', 'go-home'],
  ['m', 'go-matters'],
  ['v', 'go-verify'],
  ['r', 'go-redact'],
  ['s', 'go-search'],
  ['a', 'go-agent'],
])

const GO_KEY = 'g'
const SEQUENCE_WINDOW_MS = 800

export function moduleShortcut(module: ModuleId): ShellCommand {
  switch (module) {
    case 'home':
      return 'go-home'
    case 'matters':
      return 'go-matters'
    case 'search':
      return 'go-search'
    case 'verify':
      return 'go-verify'
    case 'agent':
      return 'go-agent'
    case 'redact':
      return 'go-redact'
    default: {
      const unhandled: never = module
      return unhandled
    }
  }
}

export function ShortcutHint({ command }: { command: ShellCommand }) {
  const isMac = useIsMacPlatform()
  return (
    <span className="inline-flex items-center gap-0.5">
      {shortcutLabels(COMMAND_KEYS[command], isMac).map((part, index) => (
        <KeyboardHint key={`${part}-${index}`}>{part}</KeyboardHint>
      ))}
    </span>
  )
}

export interface ShellKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

export type ShellKeyMatch =
  { kind: 'command'; command: ShellCommand } | { kind: 'sequence-start' } | null

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.closest('[data-paragraph-id]')) return true
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  )
}

export function matchShellKey(
  event: ShellKeyEvent,
  awaitingSequence: boolean,
): ShellKeyMatch {
  if (event.defaultPrevented || event.isComposing || event.altKey) return null
  const key = event.key.toLowerCase()
  if (isPrimaryModifier(event)) {
    const command = PRIMARY_KEYS.get(key)
    return command ? { kind: 'command', command } : null
  }
  if (isTypingTarget(event.target)) return null
  if (awaitingSequence) {
    const command = SEQUENCE_KEYS.get(key)
    return command ? { kind: 'command', command } : null
  }
  return key === GO_KEY ? { kind: 'sequence-start' } : null
}

export type ShellShortcutHandlers = Partial<Record<ShellCommand, () => void>>

export function useShellShortcuts(handlers: ShellShortcutHandlers) {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    let sequenceStartedAt = 0
    function onKeyDown(event: KeyboardEvent) {
      const awaitingSequence =
        sequenceStartedAt > 0 &&
        Date.now() - sequenceStartedAt <= SEQUENCE_WINDOW_MS
      const match = matchShellKey(event, awaitingSequence)
      if (!match) {
        if (awaitingSequence) sequenceStartedAt = 0
        return
      }
      if (match.kind === 'sequence-start') {
        sequenceStartedAt = Date.now()
        return
      }
      const run = handlersRef.current[match.command]
      sequenceStartedAt = 0
      if (!run) return
      event.preventDefault()
      run()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
