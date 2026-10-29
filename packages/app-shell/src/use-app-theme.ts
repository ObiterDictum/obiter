import { useSyncExternalStore } from 'react'

export type AppTheme = 'light' | 'dark'
export type ThemeChoice = AppTheme | 'system'

const THEME_STORAGE_KEY = 'obiter.theme.v2'

const subscribers = new Set<() => void>()

function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

function resolveTheme(choice: ThemeChoice): AppTheme {
  if (choice !== 'system') return choice
  return prefersDark() ? 'dark' : 'light'
}

function readThemeAttribute(): AppTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light'
}

function readChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'light'
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  return saved === 'dark' || saved === 'system' ? saved : 'light'
}

function apply(choice: ThemeChoice) {
  document.documentElement.setAttribute('data-theme', resolveTheme(choice))
}

function notify() {
  for (const subscriber of subscribers) subscriber()
}

export function setAppTheme(choice: ThemeChoice) {
  window.localStorage.setItem(THEME_STORAGE_KEY, choice)
  apply(choice)
  notify()
}

const subscribe = (callback: () => void) => {
  if (typeof document === 'undefined') return () => {}
  subscribers.add(callback)
  const scheme = window.matchMedia('(prefers-color-scheme: dark)')
  const onSchemeChange = () => {
    if (readChoice() !== 'system') return
    apply('system')
    notify()
  }
  scheme.addEventListener('change', onSchemeChange)
  return () => {
    subscribers.delete(callback)
    scheme.removeEventListener('change', onSchemeChange)
  }
}

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribe, readThemeAttribute, () => 'light')
}

export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readChoice, () => 'light')
}

export { THEME_STORAGE_KEY }
