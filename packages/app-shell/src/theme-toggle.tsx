import { Moon, Sun } from '@phosphor-icons/react'
import { setAppTheme, useAppTheme } from './use-app-theme'

/**
 * The theme toggle, shared by the top bar and the auth gate. One press flips
 * the theme being rendered and stores it as an explicit choice, which is how a
 * user leaves "match system".
 */
export function ThemeToggle() {
  const theme = useAppTheme()
  const next = theme === 'light' ? 'dark' : 'light'
  const label = `Switch to ${next} theme`
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setAppTheme(next)}
      className="grid size-8 shrink-0 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {theme === 'light' ? (
        <Moon size={16} aria-hidden />
      ) : (
        <Sun size={16} aria-hidden />
      )}
    </button>
  )
}
