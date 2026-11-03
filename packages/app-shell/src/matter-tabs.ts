import type { AppPlatform } from '@obiter/contracts'
import { isPrimaryModifier } from './keyboard-platform'
import { isTypingTarget } from './shell-shortcuts'

export type MatterTabKind = 'overview' | 'document' | 'verify' | 'redact'

export interface MatterTab {
  id: string
  kind: MatterTabKind
  target: string | null
  title: string
  preview: boolean
}

export interface MatterTabState {
  tabs: MatterTab[]
  lastClosed: MatterTab | null
}

export const MATTER_TAB_LIMIT = 12

const STORAGE_PREFIX = 'obiter.matterTabs'

const OVERVIEW_TAB: MatterTab = {
  id: 'overview',
  kind: 'overview',
  target: null,
  title: 'Overview',
  preview: false,
}

const VERIFY_TAB: MatterTab = {
  id: 'verify',
  kind: 'verify',
  target: null,
  title: 'Verify',
  preview: false,
}

export function overviewTab(title = OVERVIEW_TAB.title): MatterTab {
  return { ...OVERVIEW_TAB, title }
}

export function verifyTab(): MatterTab {
  return { ...VERIFY_TAB }
}

export function documentTab(documentId: string, title: string): MatterTab {
  return {
    id: `document:${documentId}`,
    kind: 'document',
    target: documentId,
    title,
    preview: false,
  }
}

export function redactTab(runId: string, title: string): MatterTab {
  return {
    id: `redact:${runId}`,
    kind: 'redact',
    target: runId,
    title,
    preview: false,
  }
}

export function matterTabStorageKey(userId: string, matterId: string) {
  return `${STORAGE_PREFIX}.${userId}.${matterId}`
}

export function matterTabPath(matterId: string, tab: MatterTab): string {
  switch (tab.kind) {
    case 'overview':
      return `/matters/${matterId}`
    case 'verify':
      return `/matters/${matterId}/verify`
    case 'document':
      return `/matters/${matterId}/documents/${tab.target ?? ''}`
    case 'redact':
      return `/matters/${matterId}/redact/${tab.target ?? ''}`
  }
}

export function matterTabFromPath(path: string): MatterTab | null {
  const match = path.match(/^\/matters\/([^/]+)(?:\/(.*))?$/)
  if (!match) return null
  const rest = match[2] ?? ''
  if (rest === '') return overviewTab()
  if (rest === 'verify') return verifyTab()
  const documentId = rest.match(/^documents\/([^/]+)$/)?.[1]
  if (documentId) return documentTab(documentId, 'Document')
  const runId = rest.match(/^redact\/([^/]+)$/)?.[1]
  if (runId) return redactTab(runId, 'Redaction run')
  return null
}

export function emptyMatterTabState(): MatterTabState {
  return { tabs: [], lastClosed: null }
}

export function readMatterTabs(
  storage: Storage | null,
  key: string,
): MatterTabState {
  try {
    return parseMatterTabState(storage?.getItem(key) ?? null)
  } catch {
    return emptyMatterTabState()
  }
}

export function writeMatterTabs(
  storage: Storage | null,
  key: string,
  state: MatterTabState,
): void {
  try {
    storage?.setItem(key, JSON.stringify(state))
  } catch {
    return
  }
}

export function parseMatterTabState(raw: string | null): MatterTabState {
  if (!raw) return emptyMatterTabState()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return emptyMatterTabState()
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs.filter(isTab) : [],
      lastClosed: isTab(parsed.lastClosed) ? parsed.lastClosed : null,
    }
  } catch {
    return emptyMatterTabState()
  }
}

export function includeRouteTab(
  tabs: MatterTab[],
  routeTab: MatterTab | null,
): MatterTab[] {
  const pinned = tabs.some((tab) => tab.kind === 'overview')
    ? tabs
    : [overviewTab(), ...tabs]
  if (!routeTab) return pinned
  if (pinned.some((tab) => tab.id === routeTab.id)) return pinned
  return capped([...pinned, routeTab])
}

export function openTab(
  tabs: MatterTab[],
  tab: MatterTab,
  options: { preview?: boolean } = {},
): MatterTab[] {
  const preview = options.preview === true
  const existing = tabs.find((item) => item.id === tab.id)
  if (existing) {
    if (preview || !existing.preview) return tabs
    return promoteTab(tabs, tab.id)
  }
  if (preview) {
    const previewIndex = tabs.findIndex((item) => item.preview)
    if (previewIndex >= 0) {
      const next = [...tabs]
      next[previewIndex] = { ...tab, preview: true }
      return capped(next)
    }
  }
  return capped([...tabs, { ...tab, preview }])
}

export function closeTab(state: MatterTabState, id: string): MatterTabState {
  const closed = state.tabs.find((tab) => tab.id === id)
  if (!closed) return state
  return {
    tabs: state.tabs.filter((tab) => tab.id !== id),
    lastClosed: closed,
  }
}

export function promoteTab(tabs: MatterTab[], id: string): MatterTab[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, preview: false } : tab))
}

export function neighbourTabId(tabs: MatterTab[], id: string): string | null {
  const index = tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return null
  return tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null
}

export function reopenLastClosed(state: MatterTabState): MatterTabState {
  if (!state.lastClosed) return state
  return { tabs: openTab(state.tabs, state.lastClosed), lastClosed: null }
}

function capped(tabs: MatterTab[]): MatterTab[] {
  const next = [...tabs]
  while (next.length > MATTER_TAB_LIMIT) {
    const index = next.findIndex((tab) => tab.kind !== 'overview')
    if (index < 0) return next
    next.splice(index, 1)
  }
  return next
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isTab(value: unknown): value is MatterTab {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    isTabKind(value.kind) &&
    (typeof value.target === 'string' || value.target === null) &&
    typeof value.title === 'string' &&
    typeof value.preview === 'boolean'
  )
}

function isTabKind(value: unknown): value is MatterTabKind {
  return (
    value === 'overview' ||
    value === 'document' ||
    value === 'verify' ||
    value === 'redact'
  )
}

export type MatterTabCommand =
  { kind: 'select'; index: number } | { kind: 'close' } | { kind: 'reopen' }

export interface MatterTabKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  isComposing?: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}

export function matchMatterTabKey(
  event: MatterTabKeyEvent,
  options: { platform: AppPlatform; tabCount: number },
): MatterTabCommand | null {
  if (options.platform !== 'desktop') return null
  if (event.defaultPrevented || event.isComposing || event.altKey) return null
  if (!isPrimaryModifier(event)) return null
  if (isTypingTarget(event.target)) return null
  const key = event.key.toLowerCase()
  if (key === 'w' && !event.shiftKey) return { kind: 'close' }
  if (key === 't' && event.shiftKey) return { kind: 'reopen' }
  if (!event.shiftKey && key >= '1' && key <= '9') {
    const index = Number(key) - 1
    return index < options.tabCount ? { kind: 'select', index } : null
  }
  return null
}
