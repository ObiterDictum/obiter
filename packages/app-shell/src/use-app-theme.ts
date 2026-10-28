import { useSyncExternalStore } from 'react'

/**
 * The application theme. The *choice* is what the user picked — light, dark, or
 * "match system" — and is persisted. The *theme* is what is rendered, held on
 * `<html data-theme>` (seeded by each document root and corrected from storage
 * before first paint), so every surface — including branding — stays in step
 * with the choice rather than with the OS.
 *
 * Light is the product default; dark and system are saved choices.
 */
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

/** Applies and persists a choice. Called from a control, so there is no effect
 * replaying state the platform already holds. */
export function setAppTheme(choice: ThemeChoice) {
  window.localStorage.setItem(THEME_STORAGE_KEY, choice)
  apply(choice)
  notify()
}

const subscribe = (callback: () => void) => {
  if (typeof document === 'undefined') return () => {}
  subscribers.add(callback)
  // "Match system" follows the OS as it changes. A media query is the one
  // value the app cannot derive from its own state, so it is the only external
  // listener here: it repaints the stored choice, then tells subscribers.
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

/** The theme being rendered. */
export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribe, readThemeAttribute, () => 'light')
}

/** What the user chose, including "match system". */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, readChoice, () => 'light')
}

export { THEME_STORAGE_KEY }
