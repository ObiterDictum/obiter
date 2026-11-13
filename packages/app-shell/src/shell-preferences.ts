import { useState } from 'react'

export const SHELL_STORAGE_KEY = {
  sidebarCollapsed: 'obiter.sidebar.collapsed',
  contentsHidden: 'obiter.contents.hidden',
  rightSlotOpen: 'obiter.rightSlot.open',
  rightSlotTab: 'obiter.rightSlot.tab',
  layout: 'obiter.layout',
} as const

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    return
  }
}

export function useStoredFlag(
  key: string,
  fallback = false,
): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = readStored(key)
    return stored === null ? fallback : stored === 'true'
  })

  function set(next: boolean) {
    setValue(next)
    writeStored(key, String(next))
  }

  return [value, set]
}

export function useStoredText(
  key: string,
  fallback: string,
): [string, (next: string) => void] {
  const [value, setValue] = useState(() => readStored(key) ?? fallback)

  function set(next: string) {
    setValue(next)
    writeStored(key, next)
  }

  return [value, set]
}
