import {
  emptyMatterTabState,
  type MatterTab,
  type MatterTabKind,
  type MatterTabState,
} from './matter-tabs'

export function readStoredMatterTabs(key: string): MatterTabState {
  try {
    return parseMatterTabState(window.localStorage.getItem(key))
  } catch {
    return emptyMatterTabState()
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
