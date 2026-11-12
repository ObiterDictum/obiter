import { useSyncExternalStore } from 'react'
import { readDesktopBridge } from './lib/desktop-bridge'

const MODIFIER_LABELS = {
  mac: { primary: '⌘', shift: '⇧', alt: '⌥' },
  other: { primary: 'Ctrl', shift: 'Shift', alt: 'Alt' },
} as const

type Modifier = keyof (typeof MODIFIER_LABELS)['mac']

function isModifier(key: string): key is Modifier {
  return key in MODIFIER_LABELS.mac
}

function userAgentDataPlatform(): string {
  if (!('userAgentData' in navigator)) return ''
  const data = navigator.userAgentData
  if (typeof data !== 'object' || data === null || !('platform' in data)) {
    return ''
  }
  return typeof data.platform === 'string' ? data.platform : ''
}

function browserPlatform(): string {
  return userAgentDataPlatform() || navigator.platform || navigator.userAgent
}

export function isMacPlatform(): boolean {
  const bridge = readDesktopBridge()
  if (bridge) return bridge.osPlatform === 'darwin'
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(browserPlatform())
}

const subscribeToNothing = () => () => {}

export function useIsMacPlatform(): boolean {
  return useSyncExternalStore(subscribeToNothing, isMacPlatform, () => false)
}

export function modifierLabels(isMac = isMacPlatform()) {
  return isMac ? MODIFIER_LABELS.mac : MODIFIER_LABELS.other
}

export function primaryModifierLabel(isMac = isMacPlatform()): string {
  return modifierLabels(isMac).primary
}

export function shortcutLabels(
  keys: readonly string[],
  isMac = isMacPlatform(),
): string[] {
  const labels = modifierLabels(isMac)
  return keys.map((key) => (isModifier(key) ? labels[key] : key))
}

export function formatShortcut(
  keys: readonly string[],
  isMac = isMacPlatform(),
): string {
  return shortcutLabels(keys, isMac).join(isMac ? '' : '+')
}

export function shortcutAttribute(
  keys: readonly string[],
  isMac = isMacPlatform(),
): string {
  const modifiers = {
    primary: isMac ? 'Meta' : 'Control',
    shift: 'Shift',
    alt: 'Alt',
  } as const
  return keys.map((key) => (isModifier(key) ? modifiers[key] : key)).join('+')
}

export function isPrimaryModifier(event: {
  metaKey: boolean
  ctrlKey: boolean
}): boolean {
  return isMacPlatform() ? event.metaKey : event.ctrlKey
}
