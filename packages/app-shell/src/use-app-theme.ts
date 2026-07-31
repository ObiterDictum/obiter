import { useSyncExternalStore } from 'react'

/**
 * The application theme is the source of truth for which wordmark asset renders.
 * It is set on `<html data-theme="...">` by ThemeToggle (and seeded to "dark" in
 * the document shell), so reading it — rather than `prefers-color-scheme` — keeps
 * branding in step with the selected theme regardless of the OS color preference.
 *
 * Dark (night IDE) is the product default; light is a persisted preference.
 */
export type AppTheme = 'light' | 'dark'

const THEME_STORAGE_KEY = 'obiter.theme.v2'

function readThemeAttribute(): AppTheme {
  if (typeof document === 'undefined') {
    return 'dark'
  }
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'light'
    : 'dark'
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
  return useSyncExternalStore(subscribe, readThemeAttribute, () => 'dark')
}

export { THEME_STORAGE_KEY }
