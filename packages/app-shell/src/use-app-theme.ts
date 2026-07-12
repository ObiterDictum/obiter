import { useSyncExternalStore } from 'react'

/**
 * The application theme is the source of truth for which wordmark asset renders.
 * It is set on `<html data-theme="...">` by ThemeToggle (and seeded to "light" in
 * the document shell), so reading it — rather than `prefers-color-scheme` — keeps
 * branding in step with the selected theme regardless of the OS color preference.
 */
export type AppTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'obiter.theme'

function readThemeAttribute(): AppTheme {
  if (typeof document === 'undefined') {
    return 'light'
  }
  return document.documentElement.getAttribute('data-theme') === 'dark'
    ? 'dark'
    : 'light'
}

const subscribe = (callback: () => void) => {
  if (typeof document === 'undefined') {
    return () => {}
  }
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
