import { useAppTheme } from './use-app-theme'
import wordmarkUrl from './assets/obiter-wordmark-clear.png'
import wordmarkDarkUrl from './assets/obiter-wordmark-clear-dark.png'

/**
 * Brand wordmark. The asset is selected from the application theme state
 * (`<html data-theme>`), NOT the OS `prefers-color-scheme`, so branding tracks
 * the user's selected theme even when it disagrees with the OS preference.
 * Used by the sidebar, the loading shell, and the sign-in screen alike.
 */
export function Wordmark({ className }: { className?: string }) {
  const theme = useAppTheme()
  const src = theme === 'dark' ? wordmarkDarkUrl : wordmarkUrl
  return <img src={src} alt="Obiter" className={className} />
}
