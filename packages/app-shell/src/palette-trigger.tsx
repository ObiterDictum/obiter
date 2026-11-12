import { KeyboardHint, cn } from '@obiter/ui'
import { MagnifyingGlass } from '@obiter/ui/icons/shell'
import { useCommandPalette } from './command-palette'
import { formatShortcut, useIsMacPlatform } from './keyboard-platform'

export function PaletteTrigger({
  variant,
}: {
  variant: 'sidebar' | 'title-bar'
}) {
  const openPalette = useCommandPalette()
  const isMac = useIsMacPlatform()
  return (
    <button
      type="button"
      aria-label="Search Obiter"
      onClick={(event) => openPalette(event.currentTarget)}
      className={cn(
        'app-no-drag flex shrink-0 items-center gap-2 rounded-md border border-line bg-surface text-left',
        'transition-colors duration-150 hover:border-line-strong',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        variant === 'sidebar'
          ? 'h-8 w-full pr-1 pl-2 text-meta'
          : 'ml-auto h-[30px] w-[min(300px,32vw)] pr-1 pl-3',
        variant === 'title-bar' &&
          'max-compact:w-8 max-compact:justify-center max-compact:border-0 max-compact:bg-transparent max-compact:p-0',
      )}
    >
      <MagnifyingGlass size={16} className="shrink-0 text-subtle" aria-hidden />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-meta text-subtle',
          variant === 'title-bar' && 'max-compact:hidden',
        )}
      >
        Search Obiter
      </span>
      <KeyboardHint
        className={cn(variant === 'title-bar' && 'max-compact:hidden')}
      >
        {formatShortcut(['primary', 'K'], isMac)}
      </KeyboardHint>
    </button>
  )
}
