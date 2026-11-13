import { useSyncExternalStore } from 'react'
import { SHELL_STORAGE_KEY } from './shell-preferences'

export type ShellLayout = 'sidebar' | 'tabs' | 'clean'

const subscribers = new Set<() => void>()
let chosen: ShellLayout | null = null

function readLayout(): ShellLayout {
  if (chosen) return chosen
  try {
    const stored = window.localStorage.getItem(SHELL_STORAGE_KEY.layout)
    return stored === 'tabs' || stored === 'clean' ? stored : 'sidebar'
  } catch {
    return 'sidebar'
  }
}

function notify() {
  for (const subscriber of subscribers) subscriber()
}

export function setShellLayout(layout: ShellLayout) {
  try {
    window.localStorage.setItem(SHELL_STORAGE_KEY.layout, layout)
    chosen = null
  } catch {
    chosen = layout
  }
  notify()
}

const subscribe = (callback: () => void) => {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

export function useShellLayout(): ShellLayout {
  return useSyncExternalStore(subscribe, readLayout, () => 'sidebar')
}
