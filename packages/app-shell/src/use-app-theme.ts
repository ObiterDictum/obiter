import { useSyncExternalStore } from 'react'

/**
 * The application theme, persisted as a preference. It is stored on
 * `<html data-theme>` (seeded to light by each document root and corrected from
 * storage before first paint), so reading the attribute keeps every surface —
 * including branding — in step with the choice rather than with the OS.
 *
 * Light is the product default; dark is a saved choice.
 */
export type AppTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'obiter.theme.v2'

function readThemeAttribute(): AppTheme {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light'
}

/** Applies and persists a choice. Called from the toggle, so there is no
 * effect replaying state the platform already holds. */
export function setAppTheme(theme: AppTheme) {
  document.documentElement.setAttribute('data-theme', theme)
  window.localStorage.setItem(THEME_STORAGE_KEY, theme)
}

const subscribe = (callback: () => void) => {
  if (typeof document === 'undefined') return () => {}
  const observer = new MutationObserver(callback)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribe, readThemeAttribute, () => 'light')
}

export { THEME_STORAGE_KEY }
